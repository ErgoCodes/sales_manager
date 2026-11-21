import type { Metadata } from 'next';
import { NewDocumentPage } from '../../new-document-page';

export const metadata: Metadata = { title: 'Registrar entrada' };

export default function NewEntryPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  return NewDocumentPage({ kind: 'entry', searchParams });
}
