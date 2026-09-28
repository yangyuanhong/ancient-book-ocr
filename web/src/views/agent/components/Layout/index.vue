<template>
  <div class="agent-layout">
    <a-layout>
      <a-layout-sider :width="siderWidth" :style="siderStyle">
        <slot name="sider"></slot>
      </a-layout-sider>
      <a-layout :style="rightLayout">
        <a-layout-header :style="headerStyle">
          <slot name="header"></slot>
        </a-layout-header>
        <a-layout-content :style="contentStyle">
          <slot name="content"></slot>
        </a-layout-content>
        <a-layout-footer :style="footerStyle">
          <slot name="footer"></slot>
        </a-layout-footer>
      </a-layout>
    </a-layout>
  </div>
</template>
<script lang="ts" setup name="AgentLayout">
import type { CSSProperties } from 'vue';

const headerStyle: CSSProperties = {
  color: '#1f2937',
  // 预留两行（标题 + 正在输入）的高度，出现副标题时头部不跳动
  height: "56px",
  paddingInline: 24,
  lineHeight: '56px',
  backgroundColor: '#ffffff',
  borderBottom: '1px solid #e5e7eb',
  borderTopRightRadius:"12px"
};
// 消息区占满剩余高度，由内部 Bubble.List 自己滚动
const contentStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: 'hidden',
  color: '#1f2937',
  backgroundColor: '#f7f9fc',
};
const siderStyle: CSSProperties = {
  textAlign: 'center',
  height: "100%",
  color: '#1f2937',
  backgroundColor: '#f7f7f8',
  borderRight: '1px solid #ececef',
  marginBottom: 0,
  padding: 0,
  borderTopLeftRadius: "12px",
  borderBottomLeftRadius: "12px",

};
const siderWidth = 280;

const rightLayout: CSSProperties = {
  borderTopRightRadius: "12px",
  borderBottomRightRadius: "12px"
}

// 高度随输入框和附件面板自适应
const footerStyle: CSSProperties = {
  color: '#6b7280',
  padding: '12px 24px',
  backgroundColor: '#ffffff',
  borderTop: '1px solid #e5e7eb',
  borderBottomRightRadius: "12px",

};
</script>
<style lang="scss" scoped>
.agent-layout {
  height: 100%;
}

.ant-layout.ant-layout-has-sider {
  height: 100%;
  border-radius: 12px;
}
</style>
