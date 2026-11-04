import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HealthStatus } from '../health-status';

describe('HealthStatus', () => {
  it('shows API and DB state when healthy', () => {
    render(<HealthStatus result={{ ok: true, health: { status: 'ok', db: 'up', version: '0.1.0' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('API: ok · DB: up');
  });

  it('shows the degraded state when the database is down', () => {
    render(<HealthStatus result={{ ok: true, health: { status: 'error', db: 'down', version: '0.1.0' } }} />);
    expect(screen.getByRole('status')).toHaveTextContent('API: error · DB: down');
  });

  it('renders a controlled error when the API is unreachable', () => {
    render(<HealthStatus result={{ ok: false, reason: 'unreachable' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No se pudo consultar la API');
    expect(screen.getByRole('alert')).toHaveTextContent('no responde');
  });

  it('renders a controlled error on an unexpected response', () => {
    render(<HealthStatus result={{ ok: false, reason: 'bad-response' }} />);
    expect(screen.getByRole('alert')).toHaveTextContent('error inesperado');
  });
});
