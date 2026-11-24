<template>
  <a-modal
    :open="open"
    :title="title"
    :ok-text="okText"
    cancel-text="取消"
    :confirm-loading="confirmLoading"
    @ok="handleSubmit"
    @cancel="handleCancel"
  >
    <a-form ref="formRef" :model="form" :rules="rules" layout="vertical">
      <a-form-item label="会话名称" name="name">
        <a-input
          v-model:value="form.name"
          :maxlength="30"
          show-count
          placeholder="请输入会话名称"
          @press-enter="handleSubmit"
        />
      </a-form-item>
    </a-form>
  </a-modal>
</template>
<script setup lang="ts">
import { reactive, ref, watch } from "vue";
import type { FormInstance, Rule } from "ant-design-vue/es/form";
const props = withDefaults(defineProps<{
  open: boolean;
  confirmLoading?: boolean;
  title?: string;
  okText?: string;
  initialName?: string;
}>(), {
  confirmLoading: false,
  title: "新建会话",
  okText: "创建",
  initialName: "",
});
const emit = defineEmits<{
  "update:open": [value: boolean];
  submit: [name: string];
}>();
const formRef = ref<FormInstance>();
const form = reactive({ name: "" });
const namePattern = /^[^<>\\/:*?"|\u0000-\u001F]+$/u;
const rules: Record<string, Rule[]> = {
  name: [
    { required: true, whitespace: true, message: "请输入会话名称" },
    { max: 30, message: "会话名称最多 30 个字符" },
    {
      validator: async (_rule, value: string) => {
        if (value && !namePattern.test(value.trim()))
          throw new Error("名称包含非法字符");
      },
    },
  ],
};
watch(
  () => props.open,
  (open) => {
    if (open) {
      form.name = props.initialName;
      formRef.value?.clearValidate();
    }
  },
);
function handleCancel() {
  emit("update:open", false);
}
async function handleSubmit() {
  try {
    const values = await formRef.value?.validate();
    const name = String(values?.name ?? form.name).trim();
    if (name) emit("submit", name);
  } catch {
    /* 表单错误由 Form.Item 展示 */
  }
}
</script>
