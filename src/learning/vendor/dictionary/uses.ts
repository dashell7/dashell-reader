import { watch } from "vue";

export type DictionaryStatus = {
    id: string;
    loading: boolean;
    result: boolean;
    state?: "idle" | "loading" | "ready" | "empty" | "error";
    message?: string;
};
type Emit = (event: "loading", status: DictionaryStatus) => void;

function useLoading(watchee: () => string, id: string, search: () => Promise<boolean>, emit: Emit, immediate = true) {
    let requestId = 0;
    watch(
        watchee,
        async (value, _oldValue, onCleanup) => {
            const currentRequest = ++requestId;
            let cancelled = false;
            onCleanup(() => { cancelled = true; });
            if (!value?.trim()) {
                emit("loading", { id, loading: false, result: false, state: "idle" });
                return;
            }
            emit("loading", { id, loading: true, result: false, state: "loading" });
            try {
                const result = await search();
                if (!cancelled && currentRequest === requestId) {
                    emit("loading", { id, loading: false, result, state: result ? "ready" : "empty" });
                }
            } catch (e) {
                if (!cancelled && currentRequest === requestId) {
                    emit("loading", { id, loading: false, result: false, state: "error",
                        message: e instanceof Error ? e.message : String(e) });
                }
            }
        },
        { immediate }
    );
}

export { useLoading };
