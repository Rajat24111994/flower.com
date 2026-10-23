import json
from decimal import Decimal, InvalidOperation
from pathlib import Path

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from shop.models import Product


class Command(BaseCommand):
    help = 'Import or update the product catalog from flower.com/flower.json.'

    def handle(self, *args, **options):
        catalog_path = Path(settings.BASE_DIR) / 'flower.com' / 'flower.json'
        try:
            with catalog_path.open(encoding='utf-8-sig') as catalog_file:
                products = json.load(catalog_file)['flower']
        except (OSError, ValueError, KeyError, TypeError) as error:
            raise CommandError('Cannot read product catalog at {}: {}'.format(catalog_path, error))

        if not isinstance(products, list):
            raise CommandError('The "flower" catalog value must be a list.')

        imported = 0
        try:
            with transaction.atomic():
                for item in products:
                    external_id = str(item['id'])
                    name = str(item['title']).strip()
                    if not name:
                        raise ValueError('product {} has an empty title'.format(external_id))

                    Product.objects.update_or_create(
                        external_id=external_id,
                        defaults={
                            'name': name,
                            'description': str(item.get('description', '')),
                            'image_url': str(item.get('image', '')),
                            'unit_price': Decimal(str(item['price'])).quantize(Decimal('0.01')),
                            'currency': 'USD',
                            'is_active': True,
                        },
                    )
                    imported += 1
        except (KeyError, TypeError, ValueError, InvalidOperation) as error:
            raise CommandError('Invalid product catalog entry: {}'.format(error))

        self.stdout.write(self.style.SUCCESS('Imported or updated {} products.'.format(imported)))
