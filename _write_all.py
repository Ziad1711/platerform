import os,json,base64,sys
print("script loaded")
def write_file(path, content):
    d = os.path.dirname(path)
    os.makedirs(d, exist_ok=True)
    with open(path, "w", encoding="utf8") as f:
        f.write(content)
    print("Created:", path)
data = json.loads(base64.b64decode(sys.argv[1]).decode())
for fp, content in data.items():
    write_file(fp, content)
