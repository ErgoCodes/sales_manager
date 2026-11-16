export function ErrorNotice({ message }: { message: string }) {
  return (
    <p role="alert" className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
      {message}
    </p>
  );
}

export function NoAccess() {
  return <ErrorNotice message="No tienes acceso a esta sección." />;
}
