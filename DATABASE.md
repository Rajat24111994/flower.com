# Flower.com database

The Django project uses SQLite at `db.sqlite3` in the repository root. The `shop` app adds the online store's database tables:

- `Product`: catalog item, source catalog ID, price/currency, image, and optional inventory quantity.
- `Customer`: optional customer profile and Firebase UID. Orders can also be placed without an account.
- `Order`: contact details, delivery address snapshot, order/payment statuses, and totals.
- `OrderItem`: purchased product and price snapshots so order history remains meaningful if a product changes or is removed.

Create the tables and import the catalog:

```powershell
python manage.py migrate
python manage.py seed_products
python manage.py createsuperuser
python manage.py runserver
```

Manage products, customers, and orders at `http://127.0.0.1:8000/admin/`.

`db.sqlite3` is a local development database and is excluded from Git. The existing static pages in `flower.com` are not yet connected to this Django database; connecting checkout and catalog requests to a backend API is a separate integration step. Use a production database and configure backups before deploying real customer/order data.
