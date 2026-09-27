<template>
	<div id="qiaomu-english-learn-panel">
		<NConfigProvider :theme="theme" :theme-overrides="themeOverrides">
			<!-- <NThemeEditor> -->
			<NForm :model="model" label-placement="top" label-width="auto" :rules="rules"
				require-mark-placement="right-hanging">
				<!-- 一个单词或短语字符串 -->
				<NFormItem :label="t('Expression')" :label-style="labelStyle" path="expression">
					<NInput size="small" v-model:value="model.expression" :placeholder="t('A word or a phrase')" />
				</NFormItem>
				<!-- 单词或短语的含义(精简) -->
				<NFormItem :label="t('Meaning')" :label-style="labelStyle" path="meaning">
					<NInput size="small" v-model:value="model.meaning" :placeholder="t('A short definition')"
						type="textarea" autosize />
				</NFormItem>
				<!-- 变形 -->
				<NFormItem :label="t('aliases')" :label-style="labelStyle" path="aliases">
					<NInput size="small" v-model:value="model.aliases" :placeholder="t('The inflections with , spacing')"
						type="textarea" autosize />
				</NFormItem>
				<!-- 类别，可以是Word或Phrase -->
				<NFormItem :label="t('Type')" :label-style="labelStyle" path="t">
					<NRadioGroup v-model:value="model.t">
						<NRadio value="WORD">{{ t("Word") }}</NRadio>
						<NRadio value="PHRASE">{{ t("Phrase") }}</NRadio>
					</NRadioGroup>
				</NFormItem>
				<!-- 当前单词的学习状态 -->
				<NFormItem :label="t('Status')" :label-style="labelStyle" path="status">
					<NRadioGroup v-model:value="model.status" size="small">
						<NRadioButton v-for="(s, i) in status" :value="i">
							{{ s.text }}
						</NRadioButton>
					</NRadioGroup>
				</NFormItem>
				<!-- 加一些tag, 可以用来搜索 -->
				<p v-if="statusReason" class="langr-status-reason">{{ statusReason }}</p>
				<NFormItem :label="t('Tags')" :label-style="labelStyle" path="tags">
					<NSelect size="small" v-model:value="model.tags" filterable multiple tag
						:placeholder="t('Input or select some tags')" :loading="tagLoading" :options="tagOptions"
						@search="tagSearch"></NSelect>
				</NFormItem>
				<!-- 可选,可以记多条笔记 -->
				<NFormItem :label="t('Notes')" :label-style="labelStyle" path="tags">
					<NDynamicInput v-model:value="model.notes" :create-button-props="{ size: 'small' }">
						<template #create-button-default>
							{{ t("Create") }}
						</template>
						<template #="{ index, value }">
							<NInput size="small" type="textarea" :placeholder="t('Write a new note')"
								v-model:value="model.notes[index]" />
						</template>
					</NDynamicInput>
				</NFormItem>
				<!-- 可选,例句也可以记多条 -->
				<div style="margin-bottom: 8px">
				<label for="Sentences" :style="[labelStyle]">{{
					t("Sentences")
				}}</label>
			</div>
			<!-- 使用 v-for 替代 NDynamicInput 以获得更好的控制 -->
			<div v-for="(sentence, index) in model.sentences" :key="index" style="margin-bottom: 10px;">
				<div style="display: flex; gap: 8px; align-items: flex-start;">
					<div style="display: flex;
							flex-direction: column;
							flex: 1;
							border: 2px solid var(--background-modifier-border);
							border-radius: 6px;
							padding: 8px;
							background: var(--background-primary);
						">
						<NFormItem :show-label="false" :path="`sentences[${index}].text`" :rule="sourceRule">
							<NInput size="small" type="textarea" v-model:value="model.sentences[index].text"
								:placeholder="t('Origin sentence')" :autosize="{ minRows: 1, maxRows: 3 }" />
						</NFormItem>
						<NFormItem :show-feedback="false" :show-label="false" :path="`sentences[${index}].trans`">
							<NInput size="small" type="textarea" v-model:value="model.sentences[index].trans"
								:placeholder="t('Translation (Optional)')" :autosize="{ minRows: 1, maxRows: 3 }" />
						</NFormItem>
						<NFormItem :show-feedback="false" :show-label="false" :path="`sentences[${index}].origin`">
							<NInput size="small" type="textarea" v-model:value="
								model.sentences[index].origin
							" :placeholder="t('Origin (Optional)')" :autosize="{ minRows: 1, maxRows: 3 }" />
						</NFormItem>
					</div>
					
					<!-- 自定义按钮组 -->
					<div class="custom-btn-group">
						<!-- 翻译切换按钮 -->
						<button type="button"
							class="action-btn translate-btn" 
							:class="{ 'ai-mode': isAiMode(index) }"
							:disabled="isTranslating(index)"
							:aria-busy="isTranslating(index)"
							@click="toggleTransByIndex(index, model.sentences[index])"
							:aria-label="isTranslating(index) ? t('Translation in progress') : (isAiMode(index) ? t('Switch to machine translation') : t('Switch to AI translation'))"
						>
							{{ isTranslating(index) ? (isAiMode(index) ? '机…' : 'AI…') : (isAiMode(index) ? 'AI' : '机') }}
						</button>
						
						<!-- 删除按钮 -->
						<button type="button"
							class="action-btn delete-btn"
							@click="() => removeSentence(index)"
							:aria-label="t('Delete sentence')"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
						</button>
						
						<!-- 添加按钮 -->
						<button type="button"
							class="action-btn add-btn"
							@click="() => insertSentenceAfter(index)"
							:aria-label="t('Add sentence')"
						>
							<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
						</button>
					</div>
				</div>
			</div>
			
			<!-- 底部创建按钮 (当列表为空时显示，或者总是显示以便于在底部添加) -->
			<div v-if="model.sentences.length === 0" style="margin-bottom: 10px;">
				<NButton size="small" dashed style="width: 100%" @click="() => model.sentences.push(onCreateSentence())">
					{{ t("Create") }}
				</NButton>
			</div>
			</NForm>
			<!-- 提交按钮 -->
			<div style="margin-top: 10px">
				<NButton size="small" style="--n-width: 100%" attr-type="submit" @click="submit"
					:loading="submitLoading">{{ t("Submit") }}</NButton>
			</div>
			<!-- </NThemeEditor> -->
		</NConfigProvider>
	</div>
</template>

<script setup lang="ts">
import { Notice } from "obsidian";
import { logger } from "@/utils/logger";
import {
	ref,
	onMounted,
	onUnmounted,
	getCurrentInstance,
	computed,
	CSSProperties,
    watch,
} from "vue";
import {
	NForm,
	NFormItem,
	NInput,
	NRadio,
	NRadioButton,
	NRadioGroup,
	NButton,
	NDynamicInput,
	NSelect,
	SelectOption,
	NConfigProvider,
	// NThemeEditor,
	darkTheme,
	GlobalThemeOverrides,
} from "naive-ui";

import { ExpressionInfo, Sentence } from "@/db/interface";
import { t } from "@/lang/helper";
import { useEvent } from "@/utils/use";
import { LearnPanelView } from "./LearnPanelView";
import { ReadingView } from "./ReadingView";
import Plugin from "@/plugin";
import { search as youdaoSearch } from "@dict/youdao/engine";
import { search as googleTranslate } from "@dict/google/engine";
import store from "@/store";

const view: LearnPanelView =
	getCurrentInstance().appContext.config.globalProperties.view;
const plugin: Plugin =
	getCurrentInstance().appContext.config.globalProperties.plugin;

// 切换明亮/黑暗模式
const theme = computed(() => {
	return store.dark ? darkTheme : null;
});

// Naive UI writes its own component colors as inline CSS variables. Point only
// this learning form at the reader palette so inputs and the teleported tag menu
// update with the reading theme without changing their behavior or the host UI.
const panelBg = "var(--qiaomu-english-bg, var(--background-primary))";
const panelUi = "var(--qiaomu-english-ui, var(--background-secondary))";
const panelText = "var(--qiaomu-english-text, var(--text-normal))";
const panelMuted = "var(--qiaomu-english-muted, var(--text-muted))";
const panelBorder = "var(--qiaomu-english-border, var(--background-modifier-border))";
const panelAccent = "var(--qiaomu-english-accent, var(--interactive-accent))";

// 样式设置
const themeOverrides: GlobalThemeOverrides = {
	common: {},
	Form: {
		labelTextColor: panelText,
		feedbackTextColor: panelMuted,
		labelFontSizeTopMedium: "15px",
		feedbackFontSizeMedium: "13px",
		blankHeightMedium: "5px",
		feedbackHeightMedium: "22px",
	},
	Radio: {
		color: panelBg,
		textColor: panelText,
		buttonColor: panelBg,
		buttonColorActive: panelUi,
		buttonTextColor: panelText,
		buttonTextColorActive: panelAccent,
		buttonBorderColor: panelBorder,
		buttonBorderColorActive: panelAccent,
		buttonBorderRadius: "5px",
		fontSizeMedium: "13px",
		fontSizeSmall: "13px",
		buttonHeightSmall: "22px",
	},
	Input: {
		color: panelBg,
		colorHover: panelBg,
		colorFocus: panelBg,
		textColor: panelText,
		placeholderColor: panelMuted,
		border: `1px solid ${panelBorder}`,
		borderHover: `1px solid ${panelAccent}`,
		borderFocus: `1px solid ${panelAccent}`,
		fontSizeSmall: "12px",
		paddingSmall: "0 5px",
	},
	Button: {
		color: panelUi,
		colorHover: panelUi,
		colorPressed: panelUi,
		colorFocus: panelUi,
		textColor: panelText,
		border: `1px solid ${panelBorder}`,
	},
	InternalSelection: {
		color: panelBg,
		colorActive: panelBg,
		textColor: panelText,
		placeholderColor: panelMuted,
		border: `1px solid ${panelBorder}`,
		borderActive: `1px solid ${panelAccent}`,
	},
	InternalSelectMenu: {
		color: panelUi,
		optionTextColor: panelText,
		groupHeaderTextColor: panelMuted,
		optionTextColorActive: panelAccent,
	},
	DynamicInput: {
		actionMargin: "0 0 0 5px",
	},
};

//表单数据
let model = ref<any>({
	expression: null,
	meaning: null,
    // A manually added word is a learning target by default. Status 0 means
    // explicitly ignored, not “not in the vocabulary”.
    status: 1,
	t: "WORD",
	tags: [],
	notes: [],
	sentences: [],
	aliases: "",
    date: Date.now(),
});

// 表单检查规则
let rules = {
	expression: {
		required: true,
		trigger: ["blur", "input"],
		message: t("Please input a word/phrase"),
	},
	meaning: {
		required: true,
		trigger: ["blur", "input"],
		message: t("A short definition is needed"),
	},
	t: {
		required: true,
		trigger: "change",
		message: "Expression can be a word or phrase",
	},
	status: {
		required: true,
	},
};

let sourceRule = {
	required: true,
	trigger: ["blur", "input"],
	message: "At least input a source sentence",
};

let labelStyle: CSSProperties = {
	// fontSize: "16px",
	fontWeight: "bold",
	// padding: "0 0 8px 2px",
};

function onCreateSentence() {
	return {
		text: "",
		trans: "",
		origin: "",
	};
}

// 单词状态样式
const status = [
	{ text: t("Ignore"), style: "" },
	{ text: t("Learning"), style: "background-Color: #ff980055" },
	{ text: t("Familiar"), style: "background-Color: #ffeb3c55" },
	{ text: t("Known"), style: "background-Color: #9eda5855" },
	{ text: t("Learned"), style: "background-Color: #4cb05155" },
];

const statusReason = computed(() => {
	const saved = model.value.reviewState;
	if (!saved || saved.status !== model.value.status) return "";
	return saved.source === "manual" ? t("Status set manually")
		: `${t("Status set by review")} ${saved.intervalDays} ${t("Review interval days")}`;
});


// 异步获取数据库中所有tag
let tagOptions = ref<SelectOption[]>([]);
let tagLoading = ref(false);
let tags: string[] = [];

async function tagSearch(query: string) {
	tagLoading.value = true;
	if (query.length < 2) {
		tags = await plugin.db.getTags();
	}
	tagLoading.value = false;

	if (!query.length) {
		tagOptions.value = tags.map((v) => {
			return { label: v, value: v };
		});
		return;
	}
	tagOptions.value = tags
		.filter((v) => ~v.indexOf(query))
		.map((v) => {
			return { label: v, value: v };
		});
}

// 提交信息到数据库的加载状态
let submitLoading = ref(false);

async function submit() {
	if (submitLoading.value) return; // prevent double-submit
	// 表单内容检查
	if (!model.value.expression) {
		new Notice(t("Expression is empty!"));
		return;
	}
	if (!model.value.meaning) {
		new Notice(t("Meaning is empty!"));
		return;
	}
	if (
		model.value.expression.trim().split(" ").length > 1 &&
		model.value.t === "WORD"
	) {
		new Notice(t("It looks more like a PHRASE than a WORD"));
		return;
	}
	submitLoading.value = true;
	const aliasesValue = (model.value.aliases ?? "").toString();
	if (aliasesValue.trim().length !== 0) {
		model.value.aliases = aliasesValue
			.toLowerCase()
			.split(/[,，]/)
			.map((s: string) => s.trim())
			.filter((s: string) => s.length > 0);
	} else {
		model.value.aliases = [];
	}
	let data = JSON.parse(JSON.stringify(model.value));
	(data as any).expression = (data as any).expression.trim().toLowerCase();
	// 超过1条例句时，sentences中的对象会变成Proxy，尚不知原因，因此用JSON转换一下
	
	let statusCode: number | null = null;
	try {
		statusCode = await plugin.db.postExpression(data);
	} catch (error: any) {
		submitLoading.value = false;
		const reason = error?.message || "Unknown error";
		new Notice(`${t("Submit failed")}: ${reason}`);
		logger.error("Submit failed:", error);
		return;
	}
	submitLoading.value = false;

	if (statusCode !== 200) {
		const reason = `status ${statusCode}`;
		new Notice(`${t("Submit failed")}: ${reason}`);
		logger.error("Submit failed:", { statusCode, data });
		return;
	}

	new Notice(t("Submit success"));
	logger.info("Submit success:", {
		expression: data.expression,
		type: data.t,
		status: data.status,
	});

	dispatchEvent(
		new CustomEvent("qiaomu-english-event-refresh", {
			detail: {
				expression: model.value.expression,
				type: model.value.t,
				status: model.value.status,
				meaning: model.value.meaning,
				aliases: model.value.aliases,
			},
		})
	);
	dispatchEvent(new CustomEvent("qiaomu-english-event-refresh-stat"));

	if (plugin.settings.auto_refresh_db) {
		plugin.scheduleRefreshTextDB(500);
	}
	clearPanel();
};

//清空词表单
function clearPanel(){
	model.value = {
		expression: null,
		meaning: null,
		status: 1,
		t: "WORD",
		tags: [],
		notes: [],
		sentences: [],
		aliases: "",
        date: Date.now(),
	};
};

// Extract word forms from Youdao pattern string
function extractWordForms(pattern: string): string[] {
    if (!pattern) return [];
    // Remove parentheses and split by space
    // Pattern format: ( grabbing. grabbed. grabs )
    return pattern
        .replace(/[()]/g, '')
        .split(/\s+/)
        .map(s => s.replace(/\.$/, '')) // Remove trailing dot
        .filter(s => s && /^[a-zA-Z]+$/.test(s)); // Only keep valid words
}

const selectionToken = ref(0);

function decodeHtmlEntities(input: string): string {
	const textarea = document.createElement("textarea");
	let value = input;
	for (let i = 0; i < 3; i++) {
		textarea.innerHTML = value;
		const decoded = textarea.value;
		if (decoded === value) {
			break;
		}
		value = decoded;
	}
	return value;
}

function extractYoudaoTranslation(res: any): string {
	if (!res || !(res.result as any)?.translation) return "";
	const html = (res.result as any).translation as string;
	const text = html.match(/<p>([^<>]+)<\/p>/g)?.[1]?.match(/<p>(.*)<\/p>/)?.[1] ?? "";
	return text ? decodeHtmlEntities(text) : "";
}

function extractGoogleTranslation(res: any): string {
	const text = res?.result?.tgt?.trim?.() || "";
	return text ? decodeHtmlEntities(text) : "";
}

// 查询词汇时自动填充新词表单
useEvent(window, "qiaomu-english-event-search", async (evt: CustomEvent) => {
	const selectionRaw = (evt.detail.selection as string) || "";
	const selection = selectionRaw.trim();
	if (!selection) return;
	const token = ++selectionToken.value;
	const normalized = selection.toLowerCase();
	const exprType = selection.includes(" ") ? "PHRASE" : "WORD";
	const target = evt.detail.target as HTMLElement;
	let sentenceText = "";
	let defaultOrigin: string = null;

	// Prefer the sentence computed at dispatch time (reliably covers reading +
	// subtitle words); fall back to walking up from the target element.
	sentenceText = (evt.detail.sentence as string) || "";
	if (target) {
		if (!sentenceText) {
			let sentenceEl = target.parentElement?.hasClass("stns")
				? target.parentElement
				: target.parentElement?.parentElement;
			sentenceText = sentenceEl?.textContent || "";
		}

		let reading = view.app.workspace.getActiveViewOfType(ReadingView);
		if (reading) {
			let presetOrigin = view.app.metadataCache.getFileCache(reading.file)
				.frontmatter["langr-origin"];
			defaultOrigin = presetOrigin ? presetOrigin : reading.file.name;
		}
	}

	// Fast fill to avoid UI lag
	model.value = {
		expression: selection,
		meaning: "",
		status: 1,
		t: exprType,
		tags: [],
		notes: [],
		aliases: "",
		date: Date.now(),
		sentences: sentenceText
			? [
				{
					text: sentenceText,
					trans: "",
					origin: defaultOrigin,
				},
			]
			: [],
	};

	translationTypes.value = {};
	if (model.value.sentences && model.value.sentences.length > 0) {
		model.value.sentences.forEach((sen: any, idx: number) => {
			translationTypes.value[idx] = "machine";
		});
	}

	const exprPromise = plugin.db.getExpression(selection).catch((): null => null);
	const storedSenPromise = sentenceText
		? plugin.db.tryGetSen(sentenceText).catch((): null => null)
		: Promise.resolve(null);
	const formsPromise = youdaoSearch(selection).catch((): null => null);
	const translationPromise =
		plugin.settings.use_machine_trans && sentenceText
			? googleTranslate(sentenceText, plugin.settings).catch((): null => null)
			: Promise.resolve(null);

	const isCurrent = () =>
		selectionToken.value === token &&
		(model.value.expression || "").toString().trim().toLowerCase() === normalized;

	void (async () => {
		const expr = await exprPromise;
		if (!expr || !isCurrent()) return;

		const storedSen: Sentence = await storedSenPromise;
		if (!isCurrent()) return;

		if (sentenceText) {
			if (!storedSen) {
				expr.sentences = expr.sentences.concat({
					text: sentenceText,
					trans: "",
					origin: defaultOrigin,
				});
			} else {
				let added = expr.sentences.find(
					(sen: Sentence) => sen.text === sentenceText
				);
				if (!added) {
					expr.sentences = expr.sentences.concat(storedSen);
				}
			}
		}

		model.value = expr;
		if (expr.aliases && expr.aliases.length > 0) {
			model.value.aliases = expr.aliases.join(",");
		}
	})();

	void (async () => {
		const res = await formsPromise;
		if (!isCurrent()) return;
		if (model.value.aliases) return;
		if (res && (res.result as any)?.pattern) {
			const forms = extractWordForms((res.result as any).pattern);
			const uniqueForms = [...new Set(forms)];
			if (uniqueForms.length > 0) {
				model.value.aliases = uniqueForms.join(", ");
			}
		}
	})();

	void (async () => {
		const res = await translationPromise;
		if (!isCurrent()) return;
		if (!sentenceText) return;
		const filledTrans = extractGoogleTranslation(res);
		if (!filledTrans) return;
		const sentences = model.value.sentences || [];
		const targetSen = sentences.find((sen: any) => sen.text === sentenceText);
		if (targetSen && !targetSen.trans) {
			targetSen.trans = filledTrans;
			if (!translationCache.value[sentenceText]) translationCache.value[sentenceText] = {};
			translationCache.value[sentenceText].machine = filledTrans;
		}
	})();
});

// 翻译切换逻辑
const translationTypes = ref<Record<number, 'machine' | 'ai'>>({});
const translationCache = ref<Record<string, { machine?: string; ai?: string }>>({});
const translating = ref(new Set<Sentence>());

const normalizeIndex = (index: string | number) => {
    return typeof index === "number" ? index : Number(index);
};

const toggleTrans = async (index: string | number, element: any) => {
    const normalizedIndex = normalizeIndex(index);
    if (translating.value.has(element)) return;
    const currentType = translationTypes.value[normalizedIndex] || 'machine';
    const newType = currentType === 'machine' ? 'ai' : 'machine';
    const sentence = element.text; // 注意这里是 text 不是 sentence

    if (!sentence) return;

    // 初始化缓存
    if (!translationCache.value[sentence]) translationCache.value[sentence] = {};

    // 1. 检查缓存
    if (translationCache.value[sentence][newType]) {
        element.trans = translationCache.value[sentence][newType];
        translationTypes.value[normalizedIndex] = newType;
        return;
    }

    // 2. 执行翻译
    translating.value.add(element);
    try {
        let result = "";
        if (newType === 'ai') {
            result = await plugin.translateSentenceWithAi(sentence);
        } else {
            // 调用机器翻译逻辑
             let res = await googleTranslate(sentence, plugin.settings);
             result = extractGoogleTranslation(res);
        }
        result = decodeHtmlEntities(result);
        if (!result.trim()) throw new Error("Empty translation");
        if (model.value.sentences[normalizedIndex] !== element || element.text !== sentence) return;

        // 3. 更新结果和缓存
        element.trans = result;
        translationCache.value[sentence][newType] = result;
        translationTypes.value[normalizedIndex] = newType;
    } catch (e) {
        if (model.value.sentences[normalizedIndex] !== element || element.text !== sentence) return;
        const setupRequired = e instanceof Error
            && (e as Error & { qiaomuReaderReason?: string }).qiaomuReaderReason === 'notconfigured';
        new Notice(setupRequired ? e.message : t("Translation failed"));
        logger.error("Translation failed:", e);
    } finally {
        translating.value.delete(element);
    }
};

const isTranslating = (index: string | number) => {
    return translating.value.has(model.value.sentences[normalizeIndex(index)]);
};

const isAiMode = (index: string | number) => {
    return translationTypes.value[normalizeIndex(index)] === "ai";
};

const toggleTransByIndex = (index: string | number, element: Sentence) => {
    return toggleTrans(index, element);
};

const removeSentence = (index: string | number) => {
    const normalizedIndex = normalizeIndex(index);
    model.value.sentences.splice(normalizedIndex, 1);
};

const insertSentenceAfter = (index: string | number) => {
    const normalizedIndex = normalizeIndex(index);
    model.value.sentences.splice(normalizedIndex + 1, 0, onCreateSentence());
};

// 监听单词变化，重置状态
watch(() => model.value, () => {
    translationTypes.value = {};
    translating.value.clear();
});

</script>

<style lang="scss">
.langr-status-reason {
	margin: -8px 0 16px;
	color: var(--text-muted);
	font-size: var(--font-ui-small);
}

#qiaomu-english-learn-panel {
	padding-bottom: 18px;

	.n-input {
		margin: 1px 0;
	}

    /* 隐藏默认的按钮组（如果还有残留） */
	.n-dynamic-input .n-button-group {
		display: none !important;
	}

    /* 自定义按钮组样式 */
    .custom-btn-group {
        display: flex;
        flex-direction: column;
        gap: 0; /* 按钮紧贴 */
        align-items: center;
        border: 1px solid var(--background-modifier-border);
        border-radius: 6px;
        overflow: hidden;
        background: var(--background-primary);
    }

    .action-btn {
        width: 28px;
        height: 28px;
        padding: 0;
        border: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
        font-size: 0.75rem;
        font-weight: 600;
        transition: all 0.2s ease;
        color: var(--text-muted);
        user-select: none;
        background: transparent;
        font-family: inherit;
        border-bottom: 1px solid var(--background-modifier-border);

        &:last-child {
            border-bottom: none;
        }

        &:hover {
            background: var(--background-modifier-hover);
            color: var(--text-normal);
        }

        /* 翻译按钮特殊样式 */
        &.translate-btn {
			white-space: nowrap;
			font-size: 0.65rem;
            
            &.ai-mode {
                background: var(--interactive-accent);
                color: var(--text-on-accent);
            }
            
            &:hover:not(.ai-mode) {
                color: var(--interactive-accent);
            }

			&:disabled {
				cursor: progress;
				opacity: 0.75;
			}
        }

        /* 删除按钮特殊样式 */
        &.delete-btn {
            &:hover {
                color: var(--text-error);
                background: var(--background-modifier-error-hover);
            }
        }
        
        /* 添加按钮特殊样式 */
        &.add-btn {
            &:hover {
                color: var(--interactive-success);
            }
        }
    }
}
</style>
