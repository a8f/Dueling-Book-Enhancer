# Custom banlist JSON

The Card Pool settings accept a single object, an array of objects, or an object with a `banlists` array:

```json
{
  "name": "Example Format",
  "maxDate": "2012-09-01",
  "forbidden": ["Card Name", 12345],
  "limited": ["Card Name"],
  "semiLimited": ["Card Name"],
  "unlimited": []
}
```

Card names and numeric Dueling Book card IDs are accepted. The aliases `banned`, `semi_limited`, `semi-limited`, and Dueling Book's short `n/f/l/s/u` keys are also supported.
