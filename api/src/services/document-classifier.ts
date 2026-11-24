/**
 * OCR 文本的文档类型判定：古籍 / 现代文档 / 古今混排 / 无法判断。
 *
 * 思路：提取若干可解释的特征，用 logistic 函数合成“是古籍”的概率，
 * 再按有效字数收缩置信度（字越少证据越弱）。古今混排单独按段落判断，
 * 典型场景是“原文 + 白话译文”。只有 ancient_book 会触发古籍大模型校对。
 */

export type DocumentType = "ancient_book" | "modern_document" | "mixed" | "unknown";

export interface ClassificationResult {
  documentType: DocumentType;
  /** 对所判定类型的置信度，0~1；无法判断时为 undefined */
  confidence?: number;
  reasons: string[];
}

const HAN = /[㐀-䶿一-鿿]/u;

// 文言特有的虚词和代词，白话里很少单独出现
const CLASSICAL_STRONG = new Set("乎矣焉哉兮曰歟欤孰奚曷吾汝毋".split(""));
// 文言高频但白话里也常见（之所以、其实、而且、所以、關於、盖房子、偶尔），只按 0.4 计权
const CLASSICAL_WEAK = new Set("也者其之而以於蓋盖爾尔弗耶邪".split(""));
// 白话特有的助词、代词，古籍里几乎不出现
const MODERN_MARKERS = new Set("的了们們吗嗎呢这這哪啊吧很把被您咱啦嘛".split(""));

// 常用繁体字（简体里写法不同的字），繁体只作为弱信号：港台现代文档也是繁体
const TRADITIONAL = new Set(
  (
    "們個來時為說國學會對開關過還這樣長問題東車馬門見現從後裡發經業產動實點應體頭進與書聽讀寫話語" +
    "講記認識將萬無氣軍義龍鳳鳥魚雲電單總處幾歲歷圖聖麗壽變寶當觀歸飛師廣張陳陽陰醫藥職員錢銀鐵" +
    "錯響順願類顯風餘館齊歡樂舊蘭藝蘇葉華營衛術聲聯聰網線練紅約級紀純紙細終組結給絕統絲綠緣編緊" +
    "縣縱繼續臺灣鄉禮讓謂諸謝識議論設許誠調親覺監盡禪習孫韓魯衆眾誰傳僅儀優備傷億陸隨險億"
  ).split(""),
);

// 古籍版式、目录用语；只收多字组合，避免“序”“卷”这种单字在现代文里误命中
const LAYOUT_PATTERNS: Array<[RegExp, string]> = [
  [/[欽钦]定/u, "欽定"],
  [/四[庫库]全[書书]/u, "四庫全書"],
  [/卷(之)?[一二三四五六七八九十百]+/u, "卷次"],
  [/(本紀|本纪|列傳|列传|世家)第?[一二三四五六七八九十百]*/u, "紀傳體篇目"],
  [/(集注|集解|注疏|正義|正义|箋注|笺注)/u, "注疏"],
  [/(版心|魚尾|鱼尾|刻本|抄本|鈔本)/u, "版本用语"],
];

const PUNCTUATION = /[，。！？；：、“”‘’《》「」『』（）,.!?;:]/gu;

function countIn(chars: string[], set: Set<string>): number {
  let count = 0;
  for (const char of chars) if (set.has(char)) count++;
  return count;
}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));
const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * 单段是否算文言段：只靠“之、以”这类常见字不算（白话里“之后、可以”很常见），
 * 必须至少出现一个文言特有虚词。
 */
function isClassicalSegment(chars: string[]): boolean {
  return countIn(chars, CLASSICAL_STRONG) > 0 && segmentLean(chars) > 0.8;
}

/** 单段的“文言 - 白话”倾向分：正数偏文言，负数偏白话 */
function segmentLean(chars: string[]): number {
  const han = chars.length || 1;
  const classical = countIn(chars, CLASSICAL_STRONG) + 0.4 * countIn(chars, CLASSICAL_WEAK);
  return (30 * classical - 25 * countIn(chars, MODERN_MARKERS)) / han;
}
/** 按换行和句末标点切段，过短的段合并到下一段，保证每段有足够的字做判断 */
function splitSegments(text: string, minHan = 12): string[][] {
  const segments: string[][] = [];
  let buffer: string[] = [];
  for (const piece of text.split(/[\n。！？!?；;]+/u)) {
    buffer.push(...[...piece].filter((char) => HAN.test(char)));
    if (buffer.length >= minHan) {
      segments.push(buffer);
      buffer = [];
    }
  }
  if (buffer.length) {
    if (segments.length) segments[segments.length - 1].push(...buffer);
    else segments.push(buffer);
  }
  return segments;
}

export function classifyDocument(text: string): ClassificationResult {
  const sample = text.slice(0, 20000);
  const han = [...sample].filter((char) => HAN.test(char));
  const total = han.length;

  if (total < 20) {
    return {
      documentType: "unknown",
      reasons: [`有效汉字只有 ${total} 个，无法判断文档类型`],
    };
  }

  // ---------- 特征 ----------
  const strong = countIn(han, CLASSICAL_STRONG);
  const weak = countIn(han, CLASSICAL_WEAK);
  const modern = countIn(han, MODERN_MARKERS);
  const traditionalRatio = countIn(han, TRADITIONAL) / total;
  const punctuationRatio = (sample.match(PUNCTUATION)?.length ?? 0) / total;
  const layoutHits = LAYOUT_PATTERNS.filter(([pattern]) => pattern.test(sample)).map(
    ([, label]) => label,
  );
  const lean = segmentLean(han);

  // 字数越少证据越弱：20 字约 0.33，60 字约 0.70，200 字以上接近 1
  const reliability = 1 - Math.exp(-total / 50);

  const reasons = [
    `有效汉字 ${total} 个`,
    `文言虚词 ${strong} 个（乎、矣、焉、哉、曰等），常见文言字 ${weak} 个`,
    `白话助词 ${modern} 个（的、了、们、这等）`,
    `繁体字占比 ${percent(traditionalRatio)}`,
  ];
  if (layoutHits.length) reasons.push(`古籍版式特征：${layoutHits.join("、")}`);
  if (punctuationRatio < 0.01 && total >= 50) reasons.push("几乎没有标点，符合未断句古籍");

  // ---------- 古今混排：按段落看是否同时有明显的文言段和白话段 ----------
  const segments = splitSegments(sample);
  if (segments.length >= 2) {
    let classicalHan = 0;
    let modernHan = 0;
    for (const segment of segments) {
      if (isClassicalSegment(segment)) classicalHan += segment.length;
      else if (segmentLean(segment) < -0.8) modernHan += segment.length;
    }
    const classicalShare = classicalHan / total;
    const modernShare = modernHan / total;

    if (classicalShare >= 0.2 && modernShare >= 0.2) {
      // 两部分越均衡越像“原文 + 译文”
      const balance = Math.min(classicalShare, modernShare) * 2;
      return {
        documentType: "mixed",
        confidence: round(clamp(0.55 + 0.4 * balance * reliability, 0.5, 0.95)),
        reasons: [
          ...reasons,
          `约 ${percent(classicalShare)} 的内容为文言、${percent(modernShare)} 为白话`,
        ],
      };
    }
  }

  // ---------- 古籍概率 ----------
  // 文言/白话倾向是主信号；版式、无标点是补充；繁体只是弱信号（港台现代文档也是繁体）
  const logit =
    -0.3 +
    1.6 * lean +
    0.9 * Math.min(layoutHits.length, 3) +
    (traditionalRatio > 0.08 ? 0.4 : 0) +
    (punctuationRatio < 0.01 && total >= 50 ? 0.6 : 0) +
    // 足够长却一个文言特有虚词都没有、常见文言字也很少：这本身就是现代文的证据
    // （公文、技术文档里“的、了”也不多，只看白话助词会判不出来）
    (total >= 50 && strong === 0 && weak / total < 0.05 ? -0.8 : 0);
  // 按可靠度向 0.5 收缩，短文本不会给出过高的置信度；上限 0.99，规则判断不给 100%
  const probability = clamp(0.5 + (sigmoid(logit) - 0.5) * reliability, 0.01, 0.99);

  if (probability >= 0.7) {
    return { documentType: "ancient_book", confidence: round(probability), reasons };
  }
  if (probability <= 0.3) {
    return { documentType: "modern_document", confidence: round(1 - probability), reasons };
  }
  return {
    documentType: "unknown",
    reasons: [...reasons, "文言和白话特征都不明显，无法可靠判断"],
  };
}

function round(value: number): number {
  return Number(value.toFixed(3));
}
