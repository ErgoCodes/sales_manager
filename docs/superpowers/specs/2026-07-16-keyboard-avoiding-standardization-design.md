# Standardize keyboard handling on KeyboardAvoidingView

## Context

Commit `725bdb2` migrated the app from `react-native-keyboard-controller` to
`react-native-keyboard-aware-scroll-view` (`KeyboardAwareScrollView`) as a fix
for keyboard-covering-input issues. A later, uncommitted change to
`app/inventory/stock-entry.tsx` reversed that decision for one screen only,
switching it to React Native's built-in `KeyboardAvoidingView`. This left the
app in a mixed, undecided state, and the WIP change itself has a bug: it
passes `contentContainerStyle` — a `ScrollView`-only prop — directly to
`KeyboardAvoidingView`, which doesn't scroll its content at all. On a form
taller than the screen, the padding/gap styling is dropped and the bottom
fields become unreachable once the keyboard is open.

The user chose to standardize the whole app on `KeyboardAvoidingView`,
continuing the direction of the WIP change rather than reverting it.

## Goal

Every screen that currently renders a keyboard-avoiding form uses the same
`KeyboardAvoidingView` + `ScrollView` pattern, with no leftover usage of
`KeyboardAwareScrollView` or its package.

## Scope

**Files using `KeyboardAwareScrollView` today (to migrate):**
- `app/configuration.tsx`
- `app/catalog/[id].tsx`
- `app/expenses/new.tsx`
- `app/expenses/outflow.tsx`

All four currently render:
```tsx
<KeyboardAwareScrollView
  style={{ flex: 1, backgroundColor: c.background }}
  contentContainerStyle={{ padding: 16, gap: 16 }}
>
  {/* form content */}
</KeyboardAwareScrollView>
```

**File with the WIP bug (to fix, not revert):**
- `app/inventory/stock-entry.tsx` — currently renders `KeyboardAvoidingView`
  directly with an invalid `contentContainerStyle` prop, no nested
  `ScrollView`, and an unused `KeyboardAwareScrollView` import (the source of
  the current lint warning).

**Files already on `KeyboardAvoidingView` (no change needed):**
- `app/sales/history.tsx` (modal, already correct)
- `app/sales/new-session.tsx` (already correct)

## Target pattern

```tsx
<KeyboardAvoidingView
  style={{ flex: 1, backgroundColor: c.background }}
  behavior={Platform.OS === "ios" ? "padding" : "height"}
  keyboardVerticalOffset={100}
>
  <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
    {/* form content, unchanged */}
  </ScrollView>
</KeyboardAvoidingView>
```

`behavior`/`keyboardVerticalOffset` values match what's already established
in `stock-entry.tsx` and `sales/history.tsx`, so the app is consistent.
`keyboardVerticalOffset={100}` is a starting value carried over from the
existing screens — not re-derived per screen header height, since none of
the target screens differ meaningfully in header structure from
`stock-entry.tsx`. If a specific screen needs a different offset after
manual device testing, that's a follow-up, not part of this change.

## Per-file changes

For each of the four target files:
1. Replace the `react-native-keyboard-aware-scroll-view` import with
   `KeyboardAvoidingView` from `react-native` (added to the existing
   `react-native` import line).
2. Add `Platform` and `ScrollView` to the `react-native` import line.
3. Replace the opening/closing `KeyboardAwareScrollView` tags with the
   target pattern above, wrapping existing children in the nested
   `ScrollView` unchanged.

For `stock-entry.tsx`:
1. Remove the unused `KeyboardAwareScrollView` import.
2. Add `ScrollView` to the `react-native` import line (already has
   `KeyboardAvoidingView`, `Platform`).
3. Wrap the existing children in a `ScrollView`, move
   `contentContainerStyle={{ padding: 16, gap: 16 }}` onto that `ScrollView`,
   leave `style={{ flex: 1, backgroundColor: c.background }}` +
   `behavior`/`keyboardVerticalOffset` on `KeyboardAvoidingView`.
4. Remove the stray blank line left in the WIP diff.

## Dependency cleanup

After the migration, no file imports `react-native-keyboard-aware-scroll-view`.
Run `pnpm remove react-native-keyboard-aware-scroll-view` to drop it from
`package.json` and the lockfile.

## Testing

No unit-testable logic changes (pure JSX/layout). Verification:
- `pnpm lint` and `pnpm typecheck` (already required by the pre-commit hook)
- Manual/visual check on device or simulator is recommended for keyboard
  behavior specifically, since that can't be verified by lint/typecheck —
  flag this as unverified in the completion report if no device/simulator is
  available in this environment.

## Out of scope

- Re-tuning `keyboardVerticalOffset` per screen based on actual header
  heights (follow-up if visual testing shows issues).
- Changes to `sales/history.tsx` or `sales/new-session.tsx`.
- The unrelated `app.json` bundle-identifier change (separate, already
  flagged to the user as out of scope for this work).
