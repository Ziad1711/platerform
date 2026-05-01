import base64
import os
def wf(path, content):
  d = os.path.dirname(path)
  os.makedirs(d, exist_ok=True)
  with open(path, "w", encoding="utf8") as f:
    f.write(content)
  print("Created:", path)

wf('components/advertising/ads-kpi-grid.tsx', '''test''')

wf('components/advertising/ads-kpi-grid.tsx', '''
'use client'

import { formatCurrency } from '@/lib/utils'
import {
  TrendingUp,
line1
line2
