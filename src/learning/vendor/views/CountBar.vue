<template>
    <div class="count-widget">
        <button class="count-bar" type="button" :style="{ width: barWidth }" @click="changeUnit" :aria-label="summaryLabel">
            <span class="b1" :style="styleA" aria-hidden="true"></span>
            <span class="b2" :style="styleB" aria-hidden="true"></span>
            <span class="b3" :style="styleC" aria-hidden="true"></span>
        </button>
        <div class="count-summary" role="status" aria-live="polite">
            <span class="count-summary-item">
                <i class="count-summary-dot b1" aria-hidden="true"></i>
                {{ t("Unadded") }} {{ valueLabel(props.unknown) }}
            </span>
            <span class="count-summary-item">
                <i class="count-summary-dot b2" aria-hidden="true"></i>
                {{ t("Learning") }} {{ valueLabel(props.learn) }}
            </span>
            <span class="count-summary-item">
                <i class="count-summary-dot b3" aria-hidden="true"></i>
                {{ t("Ignore") }} {{ valueLabel(props.ignore) }}
            </span>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed } from "vue";
import { t } from "@/lang/helper";
const props = defineProps({
    unknown: Number,
    learn: Number,
    ignore: Number,
});

let isPercent = ref(true);
const total = computed(() => (props.unknown || 0) + (props.learn || 0) + (props.ignore || 0));

function percent(num: number | undefined) {
    if (!isPercent.value) {
        return num || 0;
    }
    if (total.value === 0) return "0%";
    let res = (num || 0) / total.value;
    return ((Math.round(res * 1000) * 100) / 1000).toString() + "%";
}

function valueLabel(num: number | undefined) {
    return isPercent.value ? percent(num) : String(num || 0);
}

const summaryLabel = computed(() => {
    return `${t("Unadded")} ${valueLabel(props.unknown)} · ${t("Learning")} ${valueLabel(props.learn)} · ${t("Ignore")} ${valueLabel(props.ignore)} · ${total.value} ${t("words count")} · ${t("Click to switch count display")}`;
});

// Let short articles use a compact bar while longer articles get more room.
// The parent still caps the result to the available toolbar width.
const barWidth = computed(() => {
    const wordTotal = total.value;
    const width = wordTotal > 0
        ? Math.min(720, Math.max(300, 300 + Math.round(wordTotal * 0.35)))
        : 300;
    return `${width}px`;
});

function changeUnit() {
    isPercent.value = !isPercent.value;
}
function segmentStyle(num: number | undefined) {
    const value = Math.max(0, Number(num) || 0);
    // Keep an empty track visible when there is no data yet. When data exists,
    // flex-basis: 0 makes the segment width depend only on its count.
    return { flex: total.value > 0 ? `${value} 1 0%` : "1 1 0%" };
}
let styleA = computed(() => {
    return segmentStyle(props.unknown);
});
let styleB = computed(() => {
    return segmentStyle(props.learn);
});
let styleC = computed(() => {
    return segmentStyle(props.ignore);
});
</script>

<style lang="scss">
/*计数条*/
.count-bar {
    box-sizing: border-box;
    border: 2px solid var(--background-modifier-border);
    height: 22px;
    width: 100%;
    flex: 1 1 auto;
    max-width: 100%;
    min-width: 0;
    display: flex;
    align-items: center;
    overflow: hidden;
    text-align: center;
    color: var(--text-normal);
    font-size: var(--font-ui-small, 12px);
    font-weight: 500;
    cursor: pointer;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    border-radius: 10px;
    appearance: none;
    -webkit-appearance: none;
    margin: 0;
    border-style: solid;
    font-family: inherit;
    padding: 0;
    > span {
        display: flex;
        align-items: center;
        justify-content: center;
        min-width: 0;
        height: 100%;
        padding: 0;
        overflow: hidden;
        white-space: nowrap;
    }
    .b1 {
        background-color: rgba(173, 216, 230, 0.734);
        border-top-left-radius: 10px;
        border-bottom-left-radius: 10px;
    }
    .b2 {
        background-color: rgba(255, 166, 0, 0.705);
    }
    .b3 {
        background-color: rgba(211, 211, 211, 0.747);
        border-top-right-radius: 10px;
        border-bottom-right-radius: 10px;
    }
}

.count-widget {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    align-items: center;
    width: 100%;
    align-self: stretch;
    max-width: 720px;
    min-width: 0;
    gap: 4px;
}

.count-summary {
    display: flex;
    width: 100%;
    justify-content: center;
    flex-wrap: wrap;
    gap: 8px 14px;
    color: var(--text-muted);
    font-size: var(--font-ui-smaller, 11px);
    line-height: 1.2;
    font-variant-numeric: tabular-nums;
}

.count-summary-item {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    white-space: nowrap;
}

.count-summary-dot {
    width: 7px;
    height: 7px;
    flex: 0 0 7px;
    border-radius: 50%;
}

.count-summary-dot.b1 { background-color: rgba(173, 216, 230, 0.95); }
.count-summary-dot.b2 { background-color: rgba(255, 166, 0, 0.9); }
.count-summary-dot.b3 { background-color: rgba(170, 170, 170, 0.9); }
</style>
