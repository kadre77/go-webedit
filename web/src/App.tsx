import { Match, onCleanup, onMount, Show, Switch, createSignal } from "solid-js";
import { api, setAuthLostHandler } from "./api";
import { createAppState } from "./appState";
import { ConflictDialog } from "./ConflictDialog";
import { Editor } from "./Editor";
import { Sidebar } from "./Sidebar";
import { SignIn } from "./SignIn";
import { TabBar } from "./TabBar";
import { useTabShortcuts } from "./tabShortcuts";

const signInPath = "/signin";

export function App() {
  const [status, setStatus] = createSignal<"checking" | "signed-in" | "signed-out">("checking");
  const [reason, setReason] = createSignal<string>();

  const showSignIn = (why?: string) => {
    history.replaceState(null, "", why ? `${signInPath}?reason=${encodeURIComponent(why)}` : signInPath);
    setReason(why);
    setStatus("signed-out");
  };

  onMount(async () => {
    setAuthLostHandler(showSignIn);
    const why =
      location.pathname === signInPath ? (new URLSearchParams(location.search).get("reason") ?? undefined) : undefined;
    // If the server can't be reached, carry on: the app's own calls report it.
    const signedIn = await api.signedIn().catch(() => true);
    if (!signedIn) return showSignIn(why);
    if (location.pathname === signInPath) history.replaceState(null, "", "/");
    setStatus("signed-in");
  });

  return (
    <Switch>
      <Match when={status() === "signed-in"}>
        <SignedInApp />
      </Match>
      <Match when={status() === "signed-out"}>
        <SignIn reason={reason()} />
      </Match>
    </Switch>
  );
}

function SignedInApp() {
  const state = createAppState();
  onMount(() => {
    void state.loadTree();
    void state.restore();
  });
  useTabShortcuts(state);
  useOutsideChangeChecks(state);
  useDraftGuard(state);

  return (
    <div class="layout">
      <Sidebar state={state} />
      <main class="main">
        <Show when={state.error()}>
          {(message) => (
            <p class="notice" role="alert">
              {message()}
            </p>
          )}
        </Show>
        <TabBar state={state} />
        <Show
          when={state.activeTab()}
          fallback={
            <div class="placeholder">
              <h1>webedit</h1>
              <p>Pick a file in the sidebar.</p>
            </div>
          }
        >
          {(tab) => <Editor tab={tab()} onEdit={(t, doc) => state.edit(t, doc)} />}
        </Show>
        <Show when={state.conflict()} keyed>
          {(conflict) => <ConflictDialog state={state} conflict={conflict} />}
        </Show>
      </main>
    </div>
  );
}

/** Checks the open Tabs for changes made in Dropbox whenever the app comes
 * back into view: the window regains focus, or the browser tab is shown. */
function useOutsideChangeChecks(state: ReturnType<typeof createAppState>) {
  const check = () => void state.checkOutsideChanges();
  const onVisible = () => document.visibilityState === "visible" && check();
  window.addEventListener("focus", check);
  document.addEventListener("visibilitychange", onVisible);
  onCleanup(() => {
    window.removeEventListener("focus", check);
    document.removeEventListener("visibilitychange", onVisible);
  });
}

/** Writes pending Drafts to browser storage when the page is left or hidden,
 * and has the browser ask before leaving a page that has Drafts. */
function useDraftGuard(state: ReturnType<typeof createAppState>) {
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    state.flushDrafts();
    if (!state.hasDrafts()) return;
    e.preventDefault();
    e.returnValue = ""; // older browsers ask only when this is set
  };
  const flush = () => state.flushDrafts();
  const onHidden = () => document.visibilityState === "hidden" && flush();
  window.addEventListener("beforeunload", onBeforeUnload);
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", onHidden);
  onCleanup(() => {
    window.removeEventListener("beforeunload", onBeforeUnload);
    window.removeEventListener("pagehide", flush);
    document.removeEventListener("visibilitychange", onHidden);
  });
}
