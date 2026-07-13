import { format } from 'date-fns';
import { create } from 'zustand';

export interface CartItem {
  key: string;
  productId: number;
  name: string;
  unitOfMeasure: string;
  quantity: number;
  paymentMethod: 'efectivo' | 'transferencia' | 'costo';
  appliedPrice: number;
  discountPercent: number;
  costAtSale: number;
  profit: number;
}

interface CartState {
  items: CartItem[];
  date: string;
  _nextKey: number;

  addItem: (item: Omit<CartItem, 'key'>) => void;
  removeItem: (key: string) => void;
  setDate: (date: string) => void;
  clear: () => void;

  totalCash: () => number;
  totalTransfer: () => number;
  totalCost: () => number;
  grandTotal: () => number;
}

export const useCartStore = create<CartState>((set, get) => ({
  items: [],
  date: format(new Date(), 'yyyy-MM-dd'),
  _nextKey: 1,

  addItem: (item) =>
    set((s) => ({
      items: [...s.items, { ...item, key: String(s._nextKey) }],
      _nextKey: s._nextKey + 1,
    })),

  removeItem: (key) =>
    set((s) => ({ items: s.items.filter((i) => i.key !== key) })),

  setDate: (date) => set({ date }),

  clear: () =>
    set({ items: [], _nextKey: 1, date: format(new Date(), 'yyyy-MM-dd') }),

  totalCash: () =>
    get()
      .items.filter((i) => i.paymentMethod === 'efectivo')
      .reduce((sum, i) => sum + i.appliedPrice * i.quantity, 0),

  totalTransfer: () =>
    get()
      .items.filter((i) => i.paymentMethod === 'transferencia')
      .reduce((sum, i) => sum + i.appliedPrice * i.quantity, 0),

  totalCost: () =>
    get()
      .items.filter((i) => i.paymentMethod === 'costo')
      .reduce((sum, i) => sum + i.appliedPrice * i.quantity, 0),

  grandTotal: () =>
    get().items.reduce((sum, i) => sum + i.appliedPrice * i.quantity, 0),
}));

