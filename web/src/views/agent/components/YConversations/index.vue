<template>
  <contextHolder />
  <div class="y-conversations">
    <div class="header">
      <a-input
        v-model:value="searchValue"
        class="search-input"
        placeholder="搜索会话"
        allow-clear
        @change="handleSearchChange"
      >
        <template #prefix>
          <SearchOutlined class="search-icon" />
        </template>
      </a-input>
      <a-tooltip title="新建会话" placement="bottom">
        <button
          class="add-btn"
          type="button"
          aria-label="新建会话"
          @click="handleAddChat"
        >
          <FormOutlined />
        </button>
      </a-tooltip>
    </div>
    <div class="section-title">最近会话</div>
    <!-- 会话管理 -->
    <Conversations
      class="conversation-list"
      :menu="menuConfig"
      :items="items"
      :activeKey="activeKey"
      :style="style"
      :onActiveChange="onActiveChange"
    />
  </div>
</template>
<script lang="ts" setup name="YConversations">
import {
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
  FormOutlined,
} from "@ant-design/icons-vue";
import { theme, message } from "ant-design-vue";
import { Conversations, type ConversationsProps } from "ant-design-x-vue";
import { computed, h, ref } from "vue";

const [messageApi, contextHolder] = message.useMessage();
const { token } = theme.useToken();
const props = defineProps<{
  items: ConversationsProps["items"];
  activeKey: string;
  loading: boolean;
}>();
let searchValue = ref("");

const emits = defineEmits(["select", "edit", "create", "delete", "search"]);

const style = computed(() => ({
  borderRadius: token.value.borderRadius,
  flex: 1,
  minHeight: 0,
  margin: 0,
  padding: "0 8px 12px",
  gap: "4px",
}));

const menuConfig: ConversationsProps["menu"] = (conversation) => ({
  items: [
    {
      label: "编辑",
      // title:"编辑",
      key: "edit",
      icon: h(EditOutlined),
    },

    {
      label: "删除",
      // title: '删除',
      key: "delete",
      icon: h(DeleteOutlined),
      danger: true,
    },
  ],
  onClick: (menuInfo) => {
    console.log("menuInfo", menuInfo, conversation);
    emits(menuInfo.key as "edit" | "delete", conversation);
  },
});

const handleSearchChange = (event: { target?: { value?: string } }) => {
  emits("search", event.target?.value ?? "");
};

const handleAddChat = () => emits("create");

function onActiveChange(key: string) {
  emits("select", key);
};
</script>
<style lang="scss" scoped>
.y-conversations {
  display: flex;
  flex-direction: column;
  height: 100%;
  text-align: left;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 12px 12px 8px;
}
.search-input {
  flex: 1;
  height: 32px;
  border-color: transparent;
  border-radius: 8px;
  background: #ededf0;
  box-shadow: none;
  transition:
    background 0.2s,
    border-color 0.2s;

  &:hover {
    background: #e8e8eb;
  }

  &:focus-within {
    background: #fff;
    border-color: #d9d9de;
  }

  :deep(.ant-input) {
    background: transparent;
    font-size: 13px;
  }
}
.search-icon {
  color: #a2a2a9;
}
.add-btn {
  display: inline-flex;
  flex-shrink: 0;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #55565d;
  font-size: 16px;
  cursor: pointer;
  transition: background 0.2s;

  &:hover {
    background: #e8e8eb;
  }
}
.section-title {
  padding: 8px 20px 6px;
  color: #9a9aa1;
  font-size: 12px;
}
.conversation-list {
  overflow-y: auto;

  :deep(.ant-conversations-item) {
    height: 36px;
    padding: 0 8px 0 12px;
    border: 0;
    border-radius: 8px;
    // 覆盖组件默认的 transition: all，只对背景做过渡
    transition: background-color 0.15s;

    &:hover {
      background: #ececef;
    }

    .ant-conversations-label {
      color: #3a3a3f;
      font-size: 13px;
    }

    // 菜单按钮平时隐藏，悬浮或选中时显示
    .ant-conversations-menu-icon {
      color: #8e8e93;
      opacity: 0;
      transition: opacity 0.15s;
    }

    &:hover .ant-conversations-menu-icon {
      opacity: 1;
    }
  }

  :deep(.ant-conversations-item-active) {
    background: #e3e3e7;

    &:hover {
      background: #e3e3e7;
    }

    // 不改字重：加粗会改变文字宽度，触发省略号重算导致抖动
    .ant-conversations-label {
      color: #18181b;
    }

    .ant-conversations-menu-icon {
      opacity: 1;
    }
  }
}
</style>
