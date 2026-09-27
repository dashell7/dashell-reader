import { watch } from "vue";

type Emit = (event: "loading", status: { id: string, loading: boolean, result: boolean }) => void;

function useLoading(watchee: () => any, id: string, search: () => Promise<boolean>, emit: Emit, immediate = false) {
    let requestId = 0;
    watch(
        watchee,
        async (_value, _oldValue, onCleanup) => {
            const currentRequest = ++requestId;
            let cancelled = false;
            onCleanup(() => { cancelled = true; });
            emit("loading", { id, loading: true, result: false });
            try {
                const result = await search();
                if (!cancelled && currentRequest === requestId) {
                    emit("loading", { id, loading: false, result });
                }
            } catch (e) {
                if (!cancelled && currentRequest === requestId) {
                    emit("loading", { id, loading: false, result: false });
                }
            }
        },
        { immediate }
    );
}

export { useLoading };
