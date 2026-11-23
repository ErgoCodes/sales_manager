export function ErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
      {message}
    </p>
  );
}

export function NoAccess() {
  return <ErrorNotice message="No tienes acceso a esta sección." />;
}
