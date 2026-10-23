from django.contrib import admin

from .models import Customer, Order, OrderItem, Product


@admin.register(Product)
class ProductAdmin(admin.ModelAdmin):
    list_display = ('name', 'external_id', 'unit_price', 'currency', 'stock_quantity', 'is_active')
    list_filter = ('is_active', 'currency')
    search_fields = ('name', 'external_id')


@admin.register(Customer)
class CustomerAdmin(admin.ModelAdmin):
    list_display = ('full_name', 'email', 'phone', 'firebase_uid', 'created_at')
    search_fields = ('full_name', 'email', 'phone', 'firebase_uid')


class OrderItemInline(admin.TabularInline):
    model = OrderItem
    extra = 0
    readonly_fields = ('product_name', 'unit_price', 'quantity', 'line_total')


@admin.register(Order)
class OrderAdmin(admin.ModelAdmin):
    list_display = (
        'order_number', 'contact_name', 'status', 'payment_status', 'total', 'currency', 'created_at'
    )
    list_filter = ('status', 'payment_status', 'currency', 'created_at')
    search_fields = ('order_number', 'contact_name', 'contact_email', 'contact_phone')
    readonly_fields = ('order_number', 'created_at', 'updated_at')
    inlines = (OrderItemInline,)
