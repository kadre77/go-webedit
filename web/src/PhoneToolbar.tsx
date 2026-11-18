// The phone layout's toolbar, along the bottom of the screen: the drawer
// toggle, Goto Anything, the Command Palette and Save, for a phone without a
// keyboard. The buttons don't take focus, so tapping one while editing keeps
// the on-screen keyboard up.

export function PhoneToolbar(props: {
  drawerOpen: boolean;
  onToggleDrawer(): void;
  canSave: boolean;
  onSave(): void;
  onGotoAnything(): void;
  onCommandPalette(): void;
}) {
  const keepFocus = (e: MouseEvent) => e.preventDefault();
  return (
    <div class="phone-toolbar" role="toolbar" aria-label="Editor actions" onMouseDown={keepFocus}>
      <button
        type="button"
        aria-label="Files"
        aria-expanded={props.drawerOpen}
        aria-controls="sidebar"
        onClick={() => props.onToggleDrawer()}
      >
        <span aria-hidden="true">☰</span> Files
      </button>
      <button type="button" aria-label="Goto Anything" onClick={() => props.onGotoAnything()}>
        Go to
      </button>
      <button type="button" aria-label="Command Palette" onClick={() => props.onCommandPalette()}>
        Commands
      </button>
      <button type="button" class="primary" disabled={!props.canSave} onClick={() => props.onSave()}>
        Save
      </button>
    </div>
  );
}
