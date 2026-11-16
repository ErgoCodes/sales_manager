/** POST form (never a link): logout changes state, so it must not be reachable by GET. */
export function LogoutButton() {
  return (
    <form method="post" action="/logout">
      <button type="submit" className="rounded-md border px-3 py-1.5 text-sm">
        Cerrar sesión
      </button>
    </form>
  );
}
