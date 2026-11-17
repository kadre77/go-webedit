import { Show } from "solid-js";

// What the sign-in page says, by the reason the Owner landed on it. The
// server's callback and sign-out redirect to /signin?reason=...; the app adds
// "unauthorized" and "reauthorize" when an API call finds the Owner signed out.
const messages: Record<string, { text: string; alert: boolean }> = {
  "signed-out": { text: "You're signed out.", alert: false },
  unauthorized: { text: "Your session ended. Sign in again to continue.", alert: true },
  reauthorize: {
    text: "Dropbox no longer accepts this app's authorization: it expired or was revoked. Sign in again to continue.",
    alert: true,
  },
  "not-owner": {
    text: "That Dropbox account isn't allowed to use this app. Sign in with the Owner's Dropbox account.",
    alert: true,
  },
  denied: { text: "Sign-in was cancelled in Dropbox.", alert: true },
  "invalid-state": { text: "Sign-in didn't complete. Try again.", alert: true },
  failed: { text: "Sign-in failed. Try again.", alert: true },
};

export function SignIn(props: { reason?: string }) {
  const message = () => (props.reason ? messages[props.reason] : undefined);
  return (
    <main class="signin">
      <h1>webedit</h1>
      <Show when={message()}>
        {(m) => <p role={m().alert ? "alert" : "status"}>{m().text}</p>}
      </Show>
      {/* A full navigation, not a fetch: the server redirects to Dropbox. */}
      <a class="button" href="/auth/signin">
        Sign in with Dropbox
      </a>
    </main>
  );
}
