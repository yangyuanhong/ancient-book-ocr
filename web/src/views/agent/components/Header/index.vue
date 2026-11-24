<template>
  <!-- 类似微信：标题居左，“正在输入”以小字显示在标题正下方 -->
  <div class="chat-header" :class="{ 'is-typing': typing }">
    <span class="chat-header__title" :title="title">{{ title }}</span>
    <Transition name="typing-fade">
      <span v-if="typing" class="chat-header__typing" aria-live="polite">
        {{ typingText }}<span class="typing-dots" aria-hidden="true">...</span>
      </span>
    </Transition>
  </div>
</template>
<script lang="ts" setup name="ChatHeader">
withDefaults(
  defineProps<{
    title?: string;
    /** 助手是否正在回复 */
    typing?: boolean;
    typingText?: string;
  }>(),
  {
    title: "",
    typing: false,
    typingText: "对方正在输入",
  },
);
</script>
<style lang="scss" scoped>
.chat-header {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  height: 100%;
  text-align: left;
  // 覆盖 a-layout-header 的行高，否则两行会被撑开
  line-height: 1.3;
}

.chat-header__title {
  max-width: 80%;
  font-size: 15px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  // 出现“正在输入”时标题上移，给副标题留位置；头部高度不变，不会抖动
  transition: transform 0.2s ease;
}

.chat-header.is-typing .chat-header__title {
  transform: translateY(-8px);
}

.chat-header__typing {
  position: absolute;
  top: 50%;
  left: 0;
  transform: translateY(6px);
  font-size: 12px;
  color: #8c8c8c;
  white-space: nowrap;
}

.typing-dots {
  display: inline-block;
  width: 18px;
  overflow: hidden;
  vertical-align: bottom;
  animation: typing-dots 1.2s steps(4, end) infinite;
}

@keyframes typing-dots {
  from {
    width: 0;
  }
  to {
    width: 18px;
  }
}

.typing-fade-enter-active,
.typing-fade-leave-active {
  transition: opacity 0.2s ease;
}

.typing-fade-enter-from,
.typing-fade-leave-to {
  opacity: 0;
}
</style>
