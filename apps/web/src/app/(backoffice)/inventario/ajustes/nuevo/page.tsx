import type { Metadata } from 'next';
import { NewDocumentPage } from '../../new-document-page';

export const metadata: Metadata = { title: 'Registrar ajuste' };

export default function NewAdjustmentPage({ searchParams }: { searchParams: Promise<{ locationId?: string }> }) {
  return NewDocumentPage({ kind: 'adjustment', searchParams });
}
