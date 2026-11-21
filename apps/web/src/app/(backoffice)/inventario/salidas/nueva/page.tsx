import type { Metadata } from 'next';
import { NewDocumentPage } from '../../new-document-page';

export const metadata: Metadata = { title: 'Registrar salida' };

export default function NewExitPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  return NewDocumentPage({ kind: 'exit', searchParams });
}
