import { Match, onMount, Show, Switch, createSignal } from "solid-js";
import { api, setAuthLostHandler } from "./api";
import { createAppState } from "./appState";
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
  onMount(() => void state.loadTree());
  useTabShortcuts(state);

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
      </main>
    </div>
  );
}
