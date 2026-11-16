using System.Text.Json;
using Flower.Api;
using Microsoft.AspNetCore.Http;
using static Flower.Api.Data;

// Differential harness: JSON fixtures are computed independently by the original JS rules.
var context = new DefaultHttpContext();
context.Request.Body = Console.OpenStandardInput();
var fixtures = await Body(context);
var result = new List<object?>();
foreach (var test in Rows(fixtures.Get("cases")))
{
    var input = test.Get("input"); var data = Obj(input);
    try
    {
        result.Add(test.S("operation") switch
        {
            "quote" => OrderRules.Validate(data, false), "checkout" => OrderRules.Validate(data, true),
            "design" => DesignEndpoints.Design(data), "stems" => DesignEndpoints.Stems(input),
            "tiers" => CatalogEndpoints.Tiers(input), "zone" => CatalogEndpoints.Zone(data),
            "vnd" => Vnd(input), "photos" => ImageEndpoints.Photos(input)?.Select(Convert.ToBase64String).ToArray(),
            "image" => DesignEndpoints.Image(input), "schedule" => OrderRules.Schedule(data.S("date"), data.S("time"), DateTime.Parse(data.S("now")).ToUniversalTime()),
            "tracking" => OrderEndpoints.PublicTracking("fixture", data), "canonical" => Vnpay.Canonical(data),
            "cart" => OrderRules.Totals(Rows(data.Get("items")), data.Get("promotion") == null ? null : Obj(data.Get("promotion")), 0, 0),
            _ => throw new InvalidOperationException("Unknown fixture")
        });
    }
    catch (ApiException error) { result.Add(new { code = error.Code, error = error.Message }); }
}
Console.Write(JsonSerializer.Serialize(result));
