<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../../lib/api';
import { session } from '../../lib/auth';
import { money } from '../../lib/format';
import { describeError, notify } from '../../lib/toast';
import PageHeader from '../../components/PageHeader.vue';
import EmptyState from '../../components/EmptyState.vue';

interface Product {
  id: string;
  sku: string | null;
  name: string;
  category: string | null;
  priceCents: number;
  currency: string;
  stockQuantity: number;
  lowStockThreshold: number;
  trackInventory: boolean;
}

interface MemberOption {
  id: string;
  firstName: string;
  lastName: string;
}

interface CartLine {
  product: Product;
  quantity: number;
}

const products = ref<Product[]>([]);
const members = ref<MemberOption[]>([]);
const cart = ref<CartLine[]>([]);
const memberSearch = ref('');
const selectedMember = ref<MemberOption | null>(null);
const categoryFilter = ref('');
const discount = ref(0);
const provider = ref<'manual' | 'stripe' | 'billplz' | 'ipay88'>('manual');
const busy = ref(false);
const loading = ref(true);
const lastReceipt = ref<{ id: string; totalCents: number; status: string } | null>(null);

const categories = computed(() => [...new Set(products.value.map((p) => p.category).filter(Boolean))] as string[]);

const visibleProducts = computed(() =>
  categoryFilter.value ? products.value.filter((p) => p.category === categoryFilter.value) : products.value,
);

const memberResults = computed(() => {
  const needle = memberSearch.value.trim().toLowerCase();
  if (!needle) return [];
  return members.value
    .filter((m) => `${m.firstName} ${m.lastName}`.toLowerCase().includes(needle))
    .slice(0, 6);
});

const subtotal = computed(() => cart.value.reduce((sum, line) => sum + line.product.priceCents * line.quantity, 0));
const discountCents = computed(() => Math.max(0, Math.min(subtotal.value, Math.round(Number(discount.value || 0) * 100))));
const total = computed(() => subtotal.value - discountCents.value);
const itemCount = computed(() => cart.value.reduce((sum, line) => sum + line.quantity, 0));

async function load(): Promise<void> {
  loading.value = true;
  try {
    const [productResponse, memberResponse] = await Promise.all([
      api.get<Product[]>('/v1/billing/products'),
      api.get<MemberOption[]>('/v1/members', { query: { limit: 200 } }),
    ]);
    products.value = productResponse.data;
    members.value = memberResponse.data;
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    loading.value = false;
  }
}

function add(product: Product): void {
  const existing = cart.value.find((line) => line.product.id === product.id);
  if (existing) {
    if (product.trackInventory && existing.quantity >= product.stockQuantity) {
      notify.error(`${product.name} is out of stock`);
      return;
    }
    existing.quantity += 1;
    return;
  }
  cart.value.push({ product, quantity: 1 });
}

function decrement(line: CartLine): void {
  line.quantity -= 1;
  if (line.quantity <= 0) cart.value = cart.value.filter((entry) => entry.product.id !== line.product.id);
}

function removeLine(line: CartLine): void {
  cart.value = cart.value.filter((entry) => entry.product.id !== line.product.id);
}

function pickMember(member: MemberOption): void {
  selectedMember.value = member;
  memberSearch.value = '';
}

async function checkout(): Promise<void> {
  if (!cart.value.length) return;
  busy.value = true;
  try {
    const { data } = await api.post<{ id: string; status: string; totalCents: number; redirectUrl?: string }>(
      '/v1/billing/pos',
      {
        academyId: session.academy?.id,
        ...(selectedMember.value ? { customerUserId: selectedMember.value.id } : {}),
        lineItems: cart.value.map((line) => ({ productId: line.product.id, quantity: line.quantity })),
        provider: provider.value,
        discountCents: discountCents.value,
        idempotencyKey: crypto.randomUUID(),
      },
    );
    lastReceipt.value = { id: data.id, totalCents: data.totalCents, status: data.status };
    cart.value = [];
    discount.value = 0;
    selectedMember.value = null;
    notify.success(`Sale recorded — ${money(data.totalCents, session.academy?.currency)}`);
    if (data.redirectUrl) window.open(data.redirectUrl, '_blank', 'noopener');
    await load();
  } catch (error) {
    notify.error(describeError(error));
  } finally {
    busy.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="Point of sale" subtitle="Charge retail to a card on file, or take cash at the desk." />

    <div class="grid gap-6 lg:grid-cols-[1fr_360px]">
      <!-- Catalogue -->
      <div>
        <div class="mb-3 flex flex-wrap gap-2">
          <button
            class="chip border transition"
            :class="!categoryFilter ? 'border-mat-600 bg-mat-600 text-white' : 'border-ink-200 bg-white text-ink-600'"
            @click="categoryFilter = ''"
          >
            All
          </button>
          <button
            v-for="category in categories"
            :key="category"
            class="chip border capitalize transition"
            :class="categoryFilter === category ? 'border-mat-600 bg-mat-600 text-white' : 'border-ink-200 bg-white text-ink-600'"
            @click="categoryFilter = category"
          >
            {{ category }}
          </button>
        </div>

        <div v-if="loading" class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <div v-for="n in 6" :key="n" class="skeleton h-32" />
        </div>

        <EmptyState v-else-if="!visibleProducts.length" title="No products" body="Add retail items to start selling." icon="🛍️" />

        <div v-else class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <button
            v-for="product in visibleProducts"
            :key="product.id"
            class="card flex flex-col items-start p-4 text-left transition hover:-translate-y-0.5 hover:shadow-pop disabled:opacity-50"
            :disabled="product.trackInventory && product.stockQuantity === 0"
            @click="add(product)"
          >
            <div class="flex w-full items-start justify-between gap-2">
              <span class="chip bg-ink-100 capitalize text-ink-600">{{ product.category ?? 'item' }}</span>
              <span
                v-if="product.trackInventory"
                class="text-[11px] font-semibold"
                :class="product.stockQuantity <= product.lowStockThreshold ? 'text-amber-600' : 'text-ink-400'"
              >
                {{ product.stockQuantity }} left
              </span>
            </div>
            <p class="mt-3 text-sm font-semibold leading-snug text-ink-900">{{ product.name }}</p>
            <p class="mt-auto pt-3 font-display text-lg font-bold tabular text-mat-700">
              {{ money(product.priceCents, product.currency) }}
            </p>
          </button>
        </div>
      </div>

      <!-- Cart -->
      <aside class="card sticky top-6 flex h-fit flex-col">
        <header class="border-b border-ink-100 px-4 py-3">
          <h2 class="font-display text-base font-bold text-ink-900">Current sale</h2>
          <p class="text-xs text-ink-500">{{ itemCount }} item{{ itemCount === 1 ? '' : 's' }}</p>
        </header>

        <div class="max-h-[22rem] overflow-y-auto px-4 py-3">
          <p v-if="!cart.length" class="py-8 text-center text-sm text-ink-400">Tap a product to add it.</p>
          <ul v-else class="space-y-2">
            <li v-for="line in cart" :key="line.product.id" class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <p class="truncate text-sm font-medium text-ink-900">{{ line.product.name }}</p>
                <p class="text-xs text-ink-500">{{ money(line.product.priceCents, line.product.currency) }} each</p>
              </div>
              <div class="flex items-center gap-1">
                <button class="h-6 w-6 rounded-md border border-ink-200 text-sm leading-none" @click="decrement(line)">−</button>
                <span class="w-6 text-center text-sm tabular">{{ line.quantity }}</span>
                <button class="h-6 w-6 rounded-md border border-ink-200 text-sm leading-none" @click="add(line.product)">+</button>
              </div>
              <button class="ml-1 text-xs text-ink-400 hover:text-rose-600" @click="removeLine(line)">✕</button>
            </li>
          </ul>
        </div>

        <div class="space-y-3 border-t border-ink-100 px-4 py-3">
          <!-- Member -->
          <div>
            <label class="label">Customer</label>
            <div v-if="selectedMember" class="flex items-center justify-between rounded-xl border border-ink-200 px-3 py-2">
              <span class="text-sm font-medium text-ink-900">{{ selectedMember.firstName }} {{ selectedMember.lastName }}</span>
              <button class="text-xs text-ink-400 hover:text-rose-600" @click="selectedMember = null">Change</button>
            </div>
            <div v-else class="relative">
              <input v-model="memberSearch" class="input" placeholder="Walk-in — or search a member" />
              <ul v-if="memberResults.length" class="absolute z-10 mt-1 w-full overflow-hidden rounded-xl border border-ink-200 bg-white shadow-pop">
                <li v-for="member in memberResults" :key="member.id">
                  <button class="block w-full px-3 py-2 text-left text-sm hover:bg-ink-50" @click="pickMember(member)">
                    {{ member.firstName }} {{ member.lastName }}
                  </button>
                </li>
              </ul>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-2">
            <div>
              <label class="label" for="discount">Discount</label>
              <input id="discount" v-model.number="discount" class="input" type="number" min="0" step="0.01" />
            </div>
            <div>
              <label class="label" for="provider">Payment</label>
              <select id="provider" v-model="provider" class="input">
                <option value="manual">Cash / manual</option>
                <option value="stripe">Stripe</option>
                <option value="billplz">Billplz</option>
                <option value="ipay88">iPay88</option>
              </select>
            </div>
          </div>

          <dl class="space-y-1 border-t border-dashed border-ink-200 pt-3 text-sm">
            <div class="flex justify-between text-ink-500"><dt>Subtotal</dt><dd class="tabular">{{ money(subtotal, session.academy?.currency) }}</dd></div>
            <div v-if="discountCents" class="flex justify-between text-emerald-600"><dt>Discount</dt><dd class="tabular">−{{ money(discountCents, session.academy?.currency) }}</dd></div>
            <div class="flex justify-between pt-1 font-display text-lg font-bold text-ink-900">
              <dt>Total</dt><dd class="tabular">{{ money(total, session.academy?.currency) }}</dd>
            </div>
          </dl>

          <button class="btn-primary w-full" :disabled="busy || !cart.length" @click="checkout">
            {{ busy ? 'Processing…' : `Charge ${money(total, session.academy?.currency)}` }}
          </button>
        </div>
      </aside>
    </div>

    <div v-if="lastReceipt" class="mt-6 card-pad flex items-center justify-between">
      <div>
        <p class="text-sm font-semibold text-ink-900">Last sale recorded</p>
        <p class="text-xs text-ink-500">
          {{ money(lastReceipt.totalCents, session.academy?.currency) }} · {{ lastReceipt.status }} ·
          <span class="font-mono">{{ lastReceipt.id.slice(0, 8) }}</span>
        </p>
      </div>
      <button class="btn-ghost btn-sm" @click="lastReceipt = null">Dismiss</button>
    </div>
  </div>
</template>
