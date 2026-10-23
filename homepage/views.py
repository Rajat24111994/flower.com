from datetime import timedelta

from django.db.models import Count, Sum
from django.db.models.functions import TruncDate
from django.shortcuts import render
from django.utils import timezone
from django.views.generic import View, TemplateView
from inventory.models import Stock
from transactions.models import SaleBill, PurchaseBill


class HomeView(View):
    template_name = "home.html"

    def get(self, request):
        today = timezone.localdate()
        month_start = today.replace(day=1)
        week_start = today - timedelta(days=6)

        stockqueryset = Stock.objects.filter(is_deleted=False).order_by('-quantity')
        monthly_sales = SaleBill.objects.filter(
            time__date__gte=month_start,
            time__date__lte=today,
        )
        daily_sales = (
            SaleBill.objects.filter(
                time__date__gte=week_start,
                time__date__lte=today,
            )
            .annotate(day=TruncDate('time'))
            .values('day')
            .annotate(order_count=Count('billno', distinct=True), revenue=Sum('salebillno__totalprice'))
        )
        daily_sales_by_date = {row['day']: row for row in daily_sales}
        revenue_by_day = []
        for offset in range(7):
            day_date = week_start + timedelta(days=offset)
            daily_summary = daily_sales_by_date.get(day_date, {})
            revenue = daily_summary.get('revenue') or 0
            revenue_by_day.append({
                'date': day_date,
                'order_count': daily_summary.get('order_count', 0),
                'revenue': revenue,
                'formatted_revenue': format(revenue, ',').replace(',', '.'),
            })

        max_daily_revenue = max((day['revenue'] for day in revenue_by_day), default=0)
        for day in revenue_by_day:
            day['bar_width'] = round(day['revenue'] * 100 / max_daily_revenue) if max_daily_revenue else 0

        recent_sales = SaleBill.objects.annotate(
            dashboard_total=Sum('salebillno__totalprice')
        ).order_by('-time')[:5]
        for sale in recent_sales:
            sale.formatted_total = format(sale.dashboard_total or 0, ',').replace(',', '.')

        monthly_summary = monthly_sales.aggregate(
            order_count=Count('billno', distinct=True),
            revenue=Sum('salebillno__totalprice'),
        )
        revenue_total = monthly_summary['revenue'] or 0
        context = {
            'today': today,
            'stock_items': stockqueryset[:6],
            'stock_count': stockqueryset.count(),
            'total_stock_units': sum(stock.quantity for stock in stockqueryset),
            'monthly_order_count': monthly_summary['order_count'],
            'monthly_revenue': format(revenue_total, ',').replace(',', '.'),
            'revenue_by_day': revenue_by_day,
            'recent_sales': recent_sales,
        }
        return render(request, self.template_name, context)

class AboutView(TemplateView):
    template_name = "about.html"