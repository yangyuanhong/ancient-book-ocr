<template>
  <a-popover
    v-model:open="open"
    placement="topRight"
    trigger="click"
    :arrow="false"
    overlay-class-name="model-selector-popover"
  >
    <template #content>
      <!-- 主面板：推理强度 -->
      <div v-if="view === 'main'" class="model-panel">
        <button
          class="icon-btn reset-btn"
          type="button"
          aria-label="恢复默认"
          title="恢复默认"
          @click="reset"
        >
          <ReloadOutlined />
        </button>
        <button class="panel-title" type="button" @click="view = 'models'">
          <span>{{ currentEffort.label }}</span><RightOutlined />
        </button>
        <div class="panel-subtitle">{{ currentModel.name }}</div>
        <div
          ref="trackRef"
          class="effort-track"
          :class="{ max: isMax, dragging: dragRatio !== null }"
          role="slider"
          tabindex="0"
          aria-label="推理强度"
          :aria-valuemin="0"
          :aria-valuemax="options.length - 1"
          :aria-valuenow="effortIndex"
          :aria-valuetext="currentEffort.label"
          :style="{ '--ratio': ratio }"
          @pointerdown="onPointerDown"
          @pointermove="onPointerMove"
          @pointerup="onPointerUp"
          @pointercancel="onPointerCancel"
          @keydown="onKeydown"
        >
          <span class="effort-fill" />
          <span
            v-for="(option, index) in options"
            :key="option.value"
            class="effort-dot"
            :class="{ filled: index < effortIndex }"
            :style="{ '--pos': toRatio(index) }"
          />
          <span class="effort-thumb" />
        </div>
      </div>
      <!-- 二级视图：模型列表，与主面板共用同一个浮层 -->
      <div v-else class="model-list">
        <div class="list-header">
          <button
            class="icon-btn"
            type="button"
            aria-label="返回"
            @click="view = 'main'"
          >
            <LeftOutlined />
          </button>
          <span class="list-title">选择模型</span>
        </div>
        <div role="listbox" aria-label="模型列表">
          <button
            v-for="item in models"
            :key="item.value"
            class="model-item"
            :class="{ selected: item.value === currentModel.value }"
            type="button"
            role="option"
            :aria-selected="item.value === currentModel.value"
            @click="selectModel(item)"
          >
            <span>{{ item.name }}</span>
            <CheckOutlined v-if="item.value === currentModel.value" />
          </button>
        </div>
      </div>
    </template>
    <button class="model-trigger" type="button" aria-haspopup="dialog">
      <span>{{ currentModel.name }}</span>
      <span class="trigger-effort">{{ currentEffort.label }}</span>
    </button>
  </a-popover>
</template>
<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import {
  CheckOutlined,
  LeftOutlined,
  ReloadOutlined,
  RightOutlined,
} from "@ant-design/icons-vue";

export interface EffortOption {
  value: string;
  label: string;
}

export interface ModelOption {
  name: string;
  value: string;
  /** 自定义该模型可选的推理强度；不传时按版本规则推导 */
  efforts?: EffortOption[];
}

const BASE_EFFORTS: EffortOption[] = [
  { value: "low", label: "轻度" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "超高" },
];
const EXTENDED_EFFORTS: EffortOption[] = [
  { value: "max", label: "Max" },
  { value: "ultra", label: "Ultra" },
];

// 5.6 及以上、非 Luna 的模型额外支持 max / ultra
function supportsExtended(value: string) {
  const version = Number(/^gpt-(\d+(?:\.\d+)?)/.exec(value)?.[1] ?? 0);
  return version >= 5.6 && !value.includes("luna");
}

const props = withDefaults(
  defineProps<{
    models?: ModelOption[];
    defaultEffort?: string;
    defaultModel?: string;
  }>(),
  {
    models: () => [
      { name: "6 Astra", value: "gpt-6-astra" },
      { name: "6 Sol", value: "gpt-6-sol" },
      { name: "5.6 Sol", value: "gpt-5.6-sol" },
      { name: "5.6 Terra", value: "gpt-5.6-terra" },
      { name: "5.6 Luna", value: "gpt-5.6-luna" },
      { name: "5.5", value: "gpt-5.5" },
    ],
    defaultEffort: "low",
    defaultModel: "gpt-6-sol",
  },
);

const emit = defineEmits<{
  change: [value: { effort: EffortOption; model: ModelOption }];
}>();

// v-model:effort 绑定推理强度，v-model:model 绑定模型 value；父组件不传时组件内部自管理
// 注意：不能用默认 v-model，它的 modelModifiers 会与 v-model:model 的修饰符 key 冲突
const effort = defineModel<string>("effort", { default: "high" });
const model = defineModel<string>("model", { default: "gpt-6-astra" });

const currentModel = computed(
  () =>
    props.models.find((m) => m.value === model.value) ??
    props.models.find((m) => m.value === props.defaultModel) ??
    props.models[0],
);
// 当前模型可选的推理强度档位
const options = computed<EffortOption[]>(() => {
  const m = currentModel.value;
  if (m.efforts?.length) return m.efforts;
  return supportsExtended(m.value)
    ? [...BASE_EFFORTS, ...EXTENDED_EFFORTS]
    : BASE_EFFORTS;
});

const open = ref(false);
const view = ref<"main" | "models">("main");
// 拖拽中的连续位置（0~1），松手后吸附到最近档位
const dragRatio = ref<number | null>(null);
const trackRef = ref<HTMLElement>();

// 与 CSS 中 --pad 保持一致：滑块半径
const THUMB_RADIUS = 15;

watch(open, (value) => {
  if (!value) view.value = "main";
});

const effortIndex = computed(() => {
  const index = options.value.findIndex((o) => o.value === effort.value);
  if (index >= 0) return index;
  return Math.max(
    0,
    options.value.findIndex((o) => o.value === props.defaultEffort),
  );
});
const currentEffort = computed(() => options.value[effortIndex.value]);
const lastIndex = computed(() => Math.max(options.value.length - 1, 1));

// 切到不支持当前档位的模型（如 max → Luna）时，降到该模型的最高档
watch(options, (list) => {
  if (!list.some((o) => o.value === effort.value)) {
    effort.value = list[list.length - 1].value;
  }
});

function toRatio(index: number) {
  return index / lastIndex.value;
}
const ratio = computed(() => dragRatio.value ?? toRatio(effortIndex.value));
// 渐变只在扩展档位（max / ultra）上显示
const isMax = computed(() =>
  EXTENDED_EFFORTS.some((o) => o.value === currentEffort.value?.value),
);

function emitChange() {
  emit("change", { effort: currentEffort.value, model: currentModel.value });
}

function setIndex(index: number, notify = true) {
  const option = options.value[Math.min(Math.max(index, 0), lastIndex.value)];
  if (!option || option.value === effort.value) return;
  effort.value = option.value;
  if (notify) emitChange();
}

function ratioFromEvent(e: PointerEvent) {
  const rect = trackRef.value!.getBoundingClientRect();
  const usable = rect.width - THUMB_RADIUS * 2;
  const r = (e.clientX - rect.left - THUMB_RADIUS) / usable;
  return Math.min(Math.max(r, 0), 1);
}

// 按下的起点；移动超过阈值才进入拖拽，避免单击时滑块先跳到指针、再吸附回档位造成抖动
let pressX: number | null = null;
const DRAG_THRESHOLD = 3;

function onPointerDown(e: PointerEvent) {
  if (e.button !== 0) return;
  trackRef.value?.setPointerCapture(e.pointerId);
  pressX = e.clientX;
}

function onPointerMove(e: PointerEvent) {
  if (pressX === null) return;
  if (dragRatio.value === null && Math.abs(e.clientX - pressX) < DRAG_THRESHOLD)
    return;
  dragRatio.value = ratioFromEvent(e);
  // 拖动时标题实时跟随档位
  setIndex(Math.round(dragRatio.value * lastIndex.value), false);
}

function onPointerUp(e: PointerEvent) {
  if (pressX === null) return;
  trackRef.value?.releasePointerCapture(e.pointerId);
  pressX = null;
  if (dragRatio.value === null) {
    // 单击：直接跳到最近档位，由过渡动画完成一次平滑移动
    setIndex(Math.round(ratioFromEvent(e) * lastIndex.value));
    return;
  }
  // 拖拽结束：从当前位置平滑吸附到档位
  dragRatio.value = null;
  emitChange();
}

function onPointerCancel() {
  if (pressX === null) return;
  const dragged = dragRatio.value !== null;
  pressX = null;
  dragRatio.value = null;
  if (dragged) emitChange();
}

function onKeydown(e: KeyboardEvent) {
  const map: Record<string, number> = {
    ArrowLeft: effortIndex.value - 1,
    ArrowDown: effortIndex.value - 1,
    ArrowRight: effortIndex.value + 1,
    ArrowUp: effortIndex.value + 1,
    Home: 0,
    End: lastIndex.value,
  };
  if (!(e.key in map)) return;
  e.preventDefault();
  setIndex(map[e.key]);
}

async function selectModel(item: ModelOption) {
  model.value = item.value;
  view.value = "main";
  // 等档位列表更新、越界档位被修正后再通知
  await nextTick();
  emitChange();
}

async function reset() {
  model.value = props.defaultModel;
  effort.value = props.defaultEffort;
  await nextTick();
  emitChange();
}
</script>
<style scoped>
.model-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: #f0f0f2;
  color: #8e8e93;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.2s;
}
.model-trigger:hover {
  background: #e7e7ea;
}
.trigger-effort {
  color: #3a3a3f;
}
.model-panel {
  position: relative;
  width: 264px;
  padding: 12px 14px 14px;
  text-align: center;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #b0b0b5;
  font-size: 12px;
  cursor: pointer;
  transition:
    background 0.2s,
    color 0.2s;
}
.icon-btn:hover {
  background: #f2f2f4;
  color: #6b6b70;
}
.reset-btn {
  position: absolute;
  top: 8px;
  right: 8px;
}
.panel-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 0;
  background: transparent;
  color: #2a9df4;
  font-size: 18px;
  font-weight: 500;
  cursor: pointer;
}
.panel-title .anticon {
  font-size: 12px;
}
.panel-subtitle {
  margin: 0 0 14px;
  color: #8e8e93;
  font-size: 13px;
}
/* 点、填充、滑块共用一套坐标：pad + (100% - 2*pad) * ratio */
.effort-track {
  --pad: 15px;
  --x: calc(var(--pad) + (100% - 2 * var(--pad)) * var(--ratio));
  position: relative;
  height: 26px;
  border-radius: 13px;
  background: #e8e8ea;
  box-shadow: inset 0 0 0 1px #dcdce0;
  cursor: pointer;
  touch-action: none;
  outline: none;
}
.effort-track:focus-visible {
  box-shadow:
    inset 0 0 0 1px #dcdce0,
    0 0 0 3px #2a9df433;
}
.effort-fill {
  position: absolute;
  inset: 0 auto 0 0;
  width: var(--x);
  border-radius: 13px;
  background: #2a9df4;
  transition:
    width 0.25s ease,
    background 0.25s ease;
}
.effort-track.max .effort-fill {
  background: linear-gradient(90deg, #2a9df4, #6b5cf6 60%, #a64cf4);
}
.effort-dot {
  position: absolute;
  top: 50%;
  left: calc(var(--pad) + (100% - 2 * var(--pad)) * var(--pos));
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: #b6b6bb;
  transform: translate(-50%, -50%);
  transition:
    transform 0.18s ease,
    background 0.18s ease;
}
/* 点太小，扩大悬浮热区 */
.effort-dot::before {
  content: "";
  position: absolute;
  inset: -8px;
}
.effort-dot:hover {
  transform: translate(-50%, -50%) scale(1.8);
  background: #8e8e93;
}
.effort-dot.filled {
  background: #ffffff8c;
}
.effort-dot.filled:hover {
  background: #fff;
}
.effort-thumb {
  position: absolute;
  top: 50%;
  left: var(--x);
  width: 30px;
  height: 30px;
  border-radius: 50%;
  background: #fff;
  box-shadow:
    0 0 0 1px #0000000f,
    0 1px 4px #00000026;
  transform: translate(-50%, -50%);
  z-index: 1;
  transition:
    left 0.25s ease,
    transform 0.18s ease,
    box-shadow 0.18s ease;
}
.effort-thumb:hover,
.effort-track.dragging .effort-thumb {
  transform: translate(-50%, -50%) scale(1.12);
  box-shadow:
    0 0 0 1px #0000000f,
    0 2px 8px #00000030;
}
/* 拖拽时位置跟手，只保留缩放过渡 */
.effort-track.dragging .effort-fill {
  transition: none;
}
.effort-track.dragging .effort-thumb {
  transition:
    transform 0.18s ease,
    box-shadow 0.18s ease;
}
.model-list {
  width: 264px;
  padding: 8px;
}
.list-header {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  height: 26px;
  margin-bottom: 4px;
}
.list-header .icon-btn {
  position: absolute;
  left: 0;
}
.list-title {
  color: #3a3a3f;
  font-size: 13px;
  font-weight: 500;
}
.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: #3a3a3f;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s;
}
.model-item:hover {
  background: #f2f2f4;
}
.model-item.selected {
  color: #2a9df4;
}
.model-item .anticon {
  font-size: 12px;
}
</style>
<style>
/* 浮层挂在 body 下，scoped 样式覆盖不到 */
.model-selector-popover .ant-popover-inner {
  padding: 0;
  border-radius: 14px;
  box-shadow:
    0 0 0 1px #0000000d,
    0 8px 24px #0000001a;
}
</style>
