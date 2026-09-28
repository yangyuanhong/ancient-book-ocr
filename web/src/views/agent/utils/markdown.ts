import MarkdownIt, {
  type MarkdownIt as MarkdownItInstance,
  type RendererRule,
} from "markdown-it";
// 只注册常用语言，避免把 highlight.js 的全部 190+ 种语言打进包里
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import css from "highlight.js/lib/languages/css";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import python from "highlight.js/lib/languages/python";
import scss from "highlight.js/lib/languages/scss";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import "highlight.js/styles/github-dark.css";

hljs.registerLanguage("bash", bash);
hljs.registerLanguage("css", css);
hljs.registerLanguage("java", java);
hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("json", json);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("python", python);
hljs.registerLanguage("scss", scss);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("yaml", yaml);
// Vue 单文件组件整体按 HTML/XML 高亮
hljs.registerAliases(["vue", "html"], { languageName: "xml" });
hljs.registerAliases(["js", "jsx"], { languageName: "javascript" });
hljs.registerAliases(["ts", "tsx"], { languageName: "typescript" });
hljs.registerAliases(["sh", "shell", "zsh"], { languageName: "bash" });
hljs.registerAliases(["py"], { languageName: "python" });
hljs.registerAliases(["yml"], { languageName: "yaml" });

// html: false 会把模型输出里的 <script> 等标签当普通文本转义，防止 XSS
const md: MarkdownItInstance = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  highlight(code, lang) {
    const language = lang && hljs.getLanguage(lang) ? lang : "";
    // hljs 输出的内容已转义，可安全拼接；未知语言走 markdown-it 默认转义
    const body = language
      ? hljs.highlight(code, { language, ignoreIllegals: true }).value
      : md.utils.escapeHtml(code);
    const label = md.utils.escapeHtml(lang || "text");

    // 复制按钮的点击由 ChatRoom 通过事件委托处理（innerHTML 渲染的内容无法直接绑定 Vue 事件）
    return [
      `<pre class="hljs code-block">`,
      `<div class="code-block__bar">`,
      `<span class="code-block__lang">${label}</span>`,
      `<button type="button" class="code-block__copy" data-copy-code aria-label="复制代码">复制</button>`,
      `</div>`,
      `<code>${body}</code>`,
      `</pre>`,
    ].join("");
  },
});

// 链接在新窗口打开，并切断 window.opener
const defaultLinkOpen: RendererRule =
  md.renderer.rules.link_open ??
  ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));

md.renderer.rules.link_open = ((tokens, idx, options, env, self) => {
  tokens[idx].attrSet("target", "_blank");
  tokens[idx].attrSet("rel", "noopener noreferrer");
  return defaultLinkOpen(tokens, idx, options, env, self);
}) satisfies RendererRule;

export function renderMarkdown(content: string): string {
  return md.render(content ?? "");
}
