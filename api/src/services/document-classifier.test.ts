import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyDocument, type DocumentType } from "./document-classifier.js";

const LUNYU =
  "子曰學而時習之不亦說乎有朋自遠方來不亦樂乎人不知而不慍不亦君子乎有子曰其為人也孝弟而好犯上者鮮矣" +
  "不好犯上而好作亂者未之有也君子務本本立而道生孝弟也者其為仁之本與";

const cases: Array<{ name: string; expect: DocumentType; text: string }> = [
  // ---------- 古籍 ----------
  { name: "繁体无标点（论语）", expect: "ancient_book", text: LUNYU },
  {
    name: "简体有标点（史记）",
    expect: "ancient_book",
    text: "太史公曰：余登箕山，其上盖有许由冢云。孔子序列古之仁圣贤人，如吴太伯、伯夷之伦详矣。余以所闻由、光义至高，其文辞不少概见，何哉？孔子曰：伯夷、叔齐，不念旧恶，怨是用希。求仁得仁，又何怨乎？",
  },
  {
    name: "带版式特征（四库本）",
    expect: "ancient_book",
    text: "欽定四庫全書\n史記卷一\n五帝本紀第一\n黃帝者少典之子姓公孫名曰軒轅生而神靈弱而能言幼而徇齊長而敦敏成而聰明軒轅之時神農氏世衰諸侯相侵伐暴虐百姓而神農氏弗能征",
  },
  {
    name: "简体（道德经）",
    expect: "ancient_book",
    text: "道可道，非常道；名可名，非常名。无名天地之始，有名万物之母。故常无欲，以观其妙；常有欲，以观其徼。此两者同出而异名，同谓之玄，玄之又玄，众妙之门。天下皆知美之为美，斯恶已；皆知善之为善，斯不善已。",
  },
  {
    name: "OCR 噪声",
    expect: "ancient_book",
    text: "子曰學而時習之不亦說乎 | 1 2 ■ 有朋自遠方來不亦樂乎 ◆ 人不知而不慍不亦君子乎 3 4 有子曰其為人也孝弟而好犯上者鮮矣 ||| 不好犯上而好作亂者未之有也 ▲ 君子務本本立而道生",
  },
  // ---------- 现代文档 ----------
  {
    name: "简体公司文案",
    expect: "modern_document",
    text: "本公司于2024年3月发布了新的数据管理系统，我们希望通过这个系统提升工作效率。用户可以在网页上查看自己的订单，也可以联系客服解决问题。如果您有任何疑问，请拨打客服电话。",
  },
  {
    name: "繁体新闻（不能因为繁体就判成古籍）",
    expect: "modern_document",
    text: "行政院今天宣布，為了因應物價上漲，政府將推出新的補助方案。民眾可以在網路上申請，預計下個月開始發放，這是今年第二次的補助。相關單位表示，他們會盡快完成審核。",
  },
  {
    name: "散文里有很多之、其、而",
    expect: "modern_document",
    text: "在这个城市之中，人们来来往往，而我却常常感到孤独。其实，生活的意义就在于我们如何看待它。之所以这样说，是因为我经历了很多事情，也慢慢明白了其中的道理。",
  },
  {
    name: "含“序言、第一卷”",
    expect: "modern_document",
    text: "序言：这本书是我多年来的研究成果，第一卷介绍了基本概念，我们会在后面的章节中详细说明。读者可以根据自己的需要选择阅读的顺序，这样会更加方便。",
  },
  {
    name: "引用一句古文",
    expect: "modern_document",
    text: "我们在学习的时候，常常会想起孔子说过的“学而时习之，不亦说乎”。这句话告诉我们，学习之后要经常复习，这样才能真正掌握知识。现在的学生压力很大，但是如果能找到学习的乐趣，就会轻松很多。老师们也应该鼓励大家多思考，而不是死记硬背。",
  },
  {
    name: "技术文档（的、了很少）",
    expect: "modern_document",
    text: "首先安装依赖，然后在配置文件中设置数据库的地址。启动服务之后，可以通过浏览器访问管理后台。如果出现错误，请检查日志文件，并确认端口没有被占用。部署到生产环境时，建议开启缓存以提高性能。",
  },
  {
    name: "公文（文白夹杂）",
    expect: "modern_document",
    text: "根据有关规定，现将本年度工作安排通知如下：各单位应于本月底前完成自查，并将结果报送办公室。对于未按期完成的单位，将予以通报。请各单位高度重视，认真落实。",
  },
  // ---------- 古今混排 / 无法判断 ----------
  {
    name: "原文 + 白话译文",
    expect: "mixed",
    text: "原文：學而時習之，不亦說乎？有朋自遠方來，不亦樂乎？人不知而不慍，不亦君子乎？\n译文：学习了知识然后按时去温习它，不也是很愉快的吗？有志同道合的人从远方来，不也是很快乐的吗？别人不了解我，我也不生气，这不就是君子吗？",
  },
  { name: "字太少", expect: "unknown", text: "目录 第一章" },
];

for (const { name, expect, text } of cases) {
  test(`${expect}：${name}`, () => {
    const result = classifyDocument(text);
    assert.equal(result.documentType, expect, result.reasons.join(" | "));
    if (expect !== "unknown") {
      assert.ok(result.confidence !== undefined && result.confidence >= 0.5, "置信度应不低于 50%");
    }
  });
}

test("置信度不会达到 100%", () => {
  const result = classifyDocument(LUNYU.repeat(10));
  assert.equal(result.documentType, "ancient_book");
  assert.ok(result.confidence! <= 0.99);
});

test("文本越长置信度越高", () => {
  const short = classifyDocument(LUNYU.slice(0, 30));
  const long = classifyDocument(LUNYU.repeat(3));
  assert.ok((long.confidence ?? 0) > (short.confidence ?? 0));
});

test("无法判断时不给置信度", () => {
  assert.equal(classifyDocument("目录").confidence, undefined);
});
