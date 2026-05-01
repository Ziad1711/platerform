import json,os
files=json.load(open("_files.json","r",encoding="utf8"))
for fp,content in files.items():
    os.makedirs(os.path.dirname(fp),exist_ok=True)
    open(fp,"w",encoding="utf8").write(content)
    print("Created:",fp)
