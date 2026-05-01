import os, base64

def wf(path, content):
  d = os.path.dirname(path)
  if d:
    os.makedirs(d, exist_ok=True)
  with open(path, 'w', encoding='utf8') as f:
    f.write(content)
  print('Created:', path)


kpi_b64 = '''
