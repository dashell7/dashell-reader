import { reactive } from "vue"; //通过使用 reactive，可以确保对象中的数据变化时，自动触发相关的视图更新

const store = reactive({
    text: "",
    dark: false,
    themeChange: false,
    fontSize: "",
    fontFamily: "",
    lineHeight: "",
    readingWidthMode: "comfortable" as "comfortable" | "full" | "manual",
    readingSideSpacing: 5,
    popupSearch: true,
    searchPinned: false,
    dictsChange: false,
    dictHeight: "300px", // 设置默认高度，与 settings.ts 保持一致
    dictFontSize: "16px", // 词典字体大小，与设置默认值保持一致
    dictFontFamily: "", // 词典字体，空字符串=继承系统字体
});

export default store; //将 store 对象导出，以便在其他组件或模块中可以导入并使用。
