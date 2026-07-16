# KeyboardAvoidingView Standardization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every remaining `KeyboardAwareScrollView` usage with the app's `KeyboardAvoidingView` + `ScrollView` pattern, fix the same bug in the WIP `stock-entry.tsx` change, and drop the now-unused `react-native-keyboard-aware-scroll-view` dependency.

**Architecture:** Purely structural JSX changes — no new logic. Each screen swaps its top-level wrapper from `KeyboardAwareScrollView` (self-scrolling) to `KeyboardAvoidingView` wrapping a `ScrollView` (explicit scroll + explicit keyboard avoidance), matching the pattern already used in `app/sales/history.tsx`. `style` stays on `KeyboardAvoidingView`; `contentContainerStyle` moves to the nested `ScrollView`. Same `behavior`/`keyboardVerticalOffset` values across all screens for consistency.

**Tech Stack:** React Native core (`KeyboardAvoidingView`, `ScrollView`, `Platform`), Expo Router, no new packages.

**Spec:** `docs/superpowers/specs/2026-07-16-keyboard-avoiding-standardization-design.md`

---

### Task 1: Fix `app/inventory/stock-entry.tsx` (WIP bug)

**Files:**
- Modify: `app/inventory/stock-entry.tsx:1-8` (imports), `app/inventory/stock-entry.tsx:124-134` (opening wrapper), `app/inventory/stock-entry.tsx:271-273` (closing wrapper)

This file currently has an uncommitted change that puts `contentContainerStyle` directly on `KeyboardAvoidingView` (which ignores it — `KeyboardAvoidingView` has no scroll content container) and leaves the `KeyboardAwareScrollView` import unused (current lint warning). Fix: remove the unused import, add `ScrollView`, nest a `ScrollView` inside `KeyboardAvoidingView`, move `contentContainerStyle` onto it, and remove the stray blank line.

- [ ] **Step 1: Update imports**

In `app/inventory/stock-entry.tsx`, replace:

```tsx
import { KeyboardAvoidingView, Platform, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
```

with:

```tsx
import { KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
```

- [ ] **Step 2: Fix the opening wrapper**

Replace:

```tsx
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}

    >
      <Stack.Screen options={{ title: "Registrar entrada" }} />
```

with:

```tsx
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
        <Stack.Screen options={{ title: "Registrar entrada" }} />
```

- [ ] **Step 3: Fix the closing wrapper and re-indent**

Replace:

```tsx
      <Button
        label={isSubmitting ? "Registrando…" : "Registrar entrada"}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
    </KeyboardAvoidingView>
  );
}
```

with:

```tsx
      <Button
        label={isSubmitting ? "Registrando…" : "Registrar entrada"}
        onPress={onSubmit}
        disabled={isSubmitting}
      />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

Everything between the opening and closing tags (lines ~125-271) is unchanged content — no re-indentation of the inner JSX is required for it to work, but if the editor auto-formats on save, let Prettier handle indentation rather than hand-editing each line.

- [ ] **Step 4: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors, no warning about `KeyboardAwareScrollView` unused in this file.

- [ ] **Step 5: Commit**

```bash
git add app/inventory/stock-entry.tsx
git commit -m "$(cat <<'EOF'
fix(inventory): wrap stock-entry form in ScrollView inside KeyboardAvoidingView

- KeyboardAvoidingView doesn't scroll its content; contentContainerStyle was silently ignored, breaking padding/gap and leaving bottom fields unreachable behind the keyboard
- Nest a ScrollView to carry contentContainerStyle and restore scroll behavior
- Drop the now-fully-unused KeyboardAwareScrollView import
EOF
)"
```

---

### Task 2: Migrate `app/configuration.tsx`

**Files:**
- Modify: `app/configuration.tsx:6-7` (imports), `app/configuration.tsx:168-171` (opening wrapper), `app/configuration.tsx:290` (closing wrapper)

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { Alert, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
```

with:

```tsx
import { Alert, KeyboardAvoidingView, Platform, ScrollView, View } from "react-native";
```

- [ ] **Step 2: Fix the opening wrapper**

Replace:

```tsx
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
```

with:

```tsx
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
```

- [ ] **Step 3: Fix the closing wrapper**

Replace:

```tsx
    </KeyboardAwareScrollView>
  );
}
```

with:

```tsx
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

(Confirm this is the final closing tag of the component's `return` — `app/configuration.tsx:290` — not an earlier unrelated `</KeyboardAwareScrollView>`; there is only one in this file per the grep in the spec.)

- [ ] **Step 4: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors, no unused-import warnings for this file.

- [ ] **Step 5: Commit**

```bash
git add app/configuration.tsx
git commit -m "$(cat <<'EOF'
refactor(configuration): replace KeyboardAwareScrollView with KeyboardAvoidingView

- Standardize on the KeyboardAvoidingView + ScrollView pattern used across the rest of the app
EOF
)"
```

---

### Task 3: Migrate `app/catalog/[id].tsx`

**Files:**
- Modify: `app/catalog/[id].tsx:6-7` (imports), `app/catalog/[id].tsx:168-171` (opening wrapper), `app/catalog/[id].tsx:386` (closing wrapper)

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
```

with:

```tsx
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
```

- [ ] **Step 2: Fix the opening wrapper**

Replace:

```tsx
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
```

with:

```tsx
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
```

- [ ] **Step 3: Fix the closing wrapper**

Replace:

```tsx
    </KeyboardAwareScrollView>
  );
}
```

with:

```tsx
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors, no unused-import warnings for this file.

- [ ] **Step 5: Commit**

```bash
git add "app/catalog/[id].tsx"
git commit -m "$(cat <<'EOF'
refactor(catalog): replace KeyboardAwareScrollView with KeyboardAvoidingView

- Standardize on the KeyboardAvoidingView + ScrollView pattern used across the rest of the app
EOF
)"
```

---

### Task 4: Migrate `app/expenses/new.tsx`

**Files:**
- Modify: `app/expenses/new.tsx:6` (import), `app/expenses/new.tsx:96-99` (opening wrapper), `app/expenses/new.tsx:170` (closing wrapper)

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
```

with:

```tsx
import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
```

(This file has no other `react-native` import line — verify with `grep -n '"react-native"' app/expenses/new.tsx` before editing; if one exists, merge into it instead of adding a second line.)

- [ ] **Step 2: Fix the opening wrapper**

Replace:

```tsx
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
```

with:

```tsx
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
```

- [ ] **Step 3: Fix the closing wrapper**

Replace:

```tsx
    </KeyboardAwareScrollView>
  );
}
```

with:

```tsx
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors, no unused-import warnings for this file.

- [ ] **Step 5: Commit**

```bash
git add app/expenses/new.tsx
git commit -m "$(cat <<'EOF'
refactor(expenses): replace KeyboardAwareScrollView with KeyboardAvoidingView

- Standardize on the KeyboardAvoidingView + ScrollView pattern used across the rest of the app
EOF
)"
```

---

### Task 5: Migrate `app/expenses/outflow.tsx`

**Files:**
- Modify: `app/expenses/outflow.tsx:6-7` (imports), `app/expenses/outflow.tsx:179-182` (opening wrapper), `app/expenses/outflow.tsx:338` (closing wrapper)

- [ ] **Step 1: Update imports**

Replace:

```tsx
import { Alert, Pressable, View } from "react-native";
import { KeyboardAwareScrollView } from "react-native-keyboard-aware-scroll-view";
```

with:

```tsx
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
```

- [ ] **Step 2: Fix the opening wrapper**

Replace:

```tsx
  return (
    <KeyboardAwareScrollView
      style={{ flex: 1, backgroundColor: c.background }}
      contentContainerStyle={{ padding: 16, gap: 16 }}
    >
```

with:

```tsx
  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.background }}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      keyboardVerticalOffset={100}
    >
      <ScrollView contentContainerStyle={{ padding: 16, gap: 16 }}>
```

- [ ] **Step 3: Fix the closing wrapper**

Replace:

```tsx
    </KeyboardAwareScrollView>
  );
}
```

with:

```tsx
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
```

- [ ] **Step 4: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors, no unused-import warnings for this file.

- [ ] **Step 5: Commit**

```bash
git add app/expenses/outflow.tsx
git commit -m "$(cat <<'EOF'
refactor(expenses): replace KeyboardAwareScrollView with KeyboardAvoidingView

- Standardize on the KeyboardAvoidingView + ScrollView pattern used across the rest of the app
EOF
)"
```

---

### Task 6: Remove the unused dependency

**Files:**
- Modify: `package.json`, `pnpm-lock.yaml`

- [ ] **Step 1: Verify no file still imports the package**

Run: `grep -rln "react-native-keyboard-aware-scroll-view" app/ components/`
Expected: no output (empty). If any file is still listed, stop and fix that file first — do not proceed to Step 2 until this is empty.

- [ ] **Step 2: Remove the package**

Run: `pnpm remove react-native-keyboard-aware-scroll-view`
Expected: `package.json` and `pnpm-lock.yaml` updated, command exits 0.

- [ ] **Step 3: Run lint and typecheck**

Run: `pnpm lint && pnpm typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
chore: remove unused react-native-keyboard-aware-scroll-view dependency

- No screen imports it anymore after standardizing on KeyboardAvoidingView
EOF
)"
```

---

### Task 7: Manual verification (not automatable in this environment)

**Files:** none — verification only.

- [ ] **Step 1: Run the app and check each migrated screen**

Run: `npx expo start` (or `npx expo start --android` / `--ios` if a device/simulator is attached).

For each of the 5 screens (`Configuración`, `Catálogo > editar producto`, `Gastos > nuevo`, `Gastos > salida de almacén`, `Inventario > registrar entrada`), open it, focus the last input field in the form, and confirm:
- The field is not hidden behind the keyboard.
- The screen scrolls if the form is taller than the visible area.
- No layout jump or clipped padding at the top/bottom.

If no simulator/device is available in this environment, state explicitly in the completion report that this step is unverified and needs manual confirmation from the user before merging.
