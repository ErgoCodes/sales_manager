import { isStagnant, isNearExpiration } from '../product-status';
import { addDays, subDays, format } from 'date-fns';

describe('product-status', () => {
  const mockToday = new Date('2026-07-13T12:00:00Z');

  describe('isStagnant', () => {
    it('returns true if never sold and stock > 0', () => {
      expect(isStagnant({ stock: 5, lastSaleDate: null, today: mockToday })).toBe(true);
    });

    it('returns false if sold 6 days ago', () => {
      const lastSaleDate = format(subDays(mockToday, 6), 'yyyy-MM-dd');
      expect(isStagnant({ stock: 5, lastSaleDate, today: mockToday })).toBe(false);
    });

    it('returns true if sold 7 days ago', () => {
      const lastSaleDate = format(subDays(mockToday, 7), 'yyyy-MM-dd');
      expect(isStagnant({ stock: 5, lastSaleDate, today: mockToday })).toBe(true);
    });

    it('returns false if stock is 0 (never stagnant)', () => {
      const lastSaleDate = format(subDays(mockToday, 10), 'yyyy-MM-dd');
      expect(isStagnant({ stock: 0, lastSaleDate, today: mockToday })).toBe(false);
      expect(isStagnant({ stock: 0, lastSaleDate: null, today: mockToday })).toBe(false);
    });
  });

  describe('isNearExpiration', () => {
    it('returns true if expiration is in 0-7 days', () => {
      const in3Days = format(addDays(mockToday, 3), 'yyyy-MM-dd');
      expect(isNearExpiration({ expirationDate: in3Days, today: mockToday })).toBe(true);
      
      const in7Days = format(addDays(mockToday, 7), 'yyyy-MM-dd');
      expect(isNearExpiration({ expirationDate: in7Days, today: mockToday })).toBe(true);

      const todayStr = format(mockToday, 'yyyy-MM-dd');
      expect(isNearExpiration({ expirationDate: todayStr, today: mockToday })).toBe(true);
    });

    it('returns false if expiration is more than 7 days away', () => {
      const in8Days = format(addDays(mockToday, 8), 'yyyy-MM-dd');
      expect(isNearExpiration({ expirationDate: in8Days, today: mockToday })).toBe(false);
    });

    it('returns false if already expired (days < 0) as per current logic', () => {
      const yesterday = format(subDays(mockToday, 1), 'yyyy-MM-dd');
      expect(isNearExpiration({ expirationDate: yesterday, today: mockToday })).toBe(false);
    });

    it('returns false if expirationDate is null', () => {
      expect(isNearExpiration({ expirationDate: null, today: mockToday })).toBe(false);
    });
  });
});
