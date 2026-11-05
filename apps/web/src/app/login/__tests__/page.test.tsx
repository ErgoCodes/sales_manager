import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sidebar } from '@/components/layout/sidebar';
import LoginPage from '../page';

describe('placeholders', () => {
  it('renders the login placeholder', () => {
    render(<LoginPage />);
    expect(screen.getByRole('heading', { name: 'Iniciar sesión' })).toBeInTheDocument();
  });

  it('renders the empty sidebar shell', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Navegación principal')).toBeInTheDocument();
  });
});
