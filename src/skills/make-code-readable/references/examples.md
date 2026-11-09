# Make Code Readable — Examples

Use examples like these in the read-only review. Adapt names to the real repo. They follow `~/.claude/rules/code-style.md`: arrow-const functions, verbs that say what happens, no vague names, named conditions, early returns.

## Example 1: Backend Pipeline Naming

Before:

```ts
export async function handle(req: Request) {
  const d = await req.json();
  const x = await save(d);
  await send(x.id);
  return Response.json({ ok: true });
}
```

After:

```ts
export const createInvoiceFromRequest = async (request: Request) => {
  const invoiceDraft = await request.json();
  const invoice = await saveInvoice(invoiceDraft);
  await sendInvoiceCreatedEmail(invoice.id);
  return Response.json({ ok: true });
};
```

Review wording:

```txt
Current: route -> handle -> save -> send
Proposed: route -> createInvoiceFromRequest -> saveInvoice -> sendInvoiceCreatedEmail

The behavior is probably fine, but the names hide the business pipeline.
```

## Example 2: Split Only The Real Stages

Before:

```ts
const processUser = async (id: string) => {
  const user = await db.user.findUnique({ where: { id } });
  if (!user) return null;

  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const label = user.isAdmin ? `${fullName} (admin)` : fullName;

  await audit.log("view_user", { id });
  return { id: user.id, label };
};
```

After:

```ts
const loadUserSummary = async (userId: string) => {
  const user = await findUserById(userId);
  const isThereNoUserFound = user === null;
  if (isThereNoUserFound) return null;

  await logUserViewed(userId);
  return createUserSummary(user);
};

const createUserSummary = (user: User) => {
  const fullName = `${user.firstName} ${user.lastName}`.trim();
  const label = user.isAdmin ? `${fullName} (admin)` : fullName;
  return { id: user.id, label };
};
```

Review wording:

```txt
This should become two named stages, not five tiny helpers:
load user -> audit side effect -> create summary
```

## Example 3: React Component To Hook Plus Pure Helper

Before:

```tsx
export const OrdersPage = ({ orders, query, status }: OrdersPageProps) => {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const visibleOrders = orders
    .filter((o) => status === "all" || o.status === status)
    .filter((o) => o.customerName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  useEffect(() => {
    if (!selectedId && visibleOrders[0]) setSelectedId(visibleOrders[0].id);
  }, [selectedId, visibleOrders]);

  return <OrdersTable orders={visibleOrders} selectedId={selectedId} onSelect={setSelectedId} />;
};
```

After, in three files (`orders-page.tsx`, `use-orders-page.ts`, `list-visible-orders.ts`), one job each:

```tsx
export const OrdersPage = (props: OrdersPageProps) => {
  const { visibleOrders, selectedId, selectOrder } = useOrdersPage(props);

  return <OrdersTable orders={visibleOrders} selectedId={selectedId} onSelect={selectOrder} />;
};
```

```ts
export const useOrdersPage = ({ orders, query, status }: OrdersPageProps) => {
  const [selectedId, selectOrder] = useState<string | null>(null);
  const visibleOrders = useMemo(() => listVisibleOrders({ orders, query, status }), [orders, query, status]);

  useEffect(() => {
    const isNothingSelected = selectedId === null;
    const hasVisibleOrder = visibleOrders.length > 0;
    if (isNothingSelected && hasVisibleOrder) selectOrder(visibleOrders[0].id);
  }, [selectedId, visibleOrders]);

  return { visibleOrders, selectedId, selectOrder };
};
```

```ts
export const listVisibleOrders = ({ orders, query, status }: OrdersFilter) =>
  orders
    .filter((order) => status === "all" || order.status === status)
    .filter((order) => order.customerName.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
```

Review wording:

```txt
Current: OrdersPage owns state + filtering + sorting + default selection + UI
Proposed: OrdersPage shows UI, useOrdersPage owns state/effect, listVisibleOrders is the pure filter
```

## Example 4: Do Not Over-Extract

Before:

```ts
const isPaid = (invoice: Invoice) => invoice.status === "paid";

const paidInvoices = invoices.filter(isPaid);
```

After:

```ts
const paidInvoices = invoices.filter((invoice) => invoice.status === "paid");
```

Review wording:

```txt
Inline this helper. The name does not reveal a pipeline step; it makes the reader jump for one comparison.
```

## Example 5: Folder Rename Review

Before:

```txt
src/lib/data/orderStuff.ts
src/lib/data/doOrder.ts
src/components/order.tsx
```

After:

```txt
src/orders/orders-client.ts
src/orders/order-summary.ts
src/orders/order-page.tsx
```

Review wording:

```txt
Current folders hide ownership: "lib/data" mixes API calls, summary logic and UI-specific naming.
Proposed: one folder named after the job (orders), kebab-case files named after what they export.
Risk: import churn across order screens; search usages before applying.
```
