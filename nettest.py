import urllib.request, ssl
try:
    r = urllib.request.urlopen("https://store.steampowered.com/api/appdetails?appids=606150", timeout=25)
    d = r.read().decode("utf-8","replace")
    print("OK", len(d), d[:200])
except Exception as e:
    print("ERR", type(e).__name__, e)
