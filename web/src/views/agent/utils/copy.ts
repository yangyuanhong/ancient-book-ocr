import Clipboard from "clipboard";

/**
 * 复制文本到剪贴板。
 * navigator.clipboard 只在 https / localhost 下可用，内网 http 部署时回退到 clipboard.js。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 权限被拒绝时继续走回退方案
    }
  }

  try {
    return Clipboard.copy(text).length > 0 || text.length === 0;
  } catch {
    return false;
  }
}
