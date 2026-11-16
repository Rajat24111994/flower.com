using System.Reflection;
using FlowerFlow.Commerce;
using FlowerFlow.Domain.Commerce;
using FlowerFlow.InMemory;
using Microsoft.AspNetCore.Mvc;
using Xunit;

namespace FlowerFlow.Backend.Tests;

[Trait("Category", "Architecture")]
public sealed class ArchitectureTests
{
    [Fact]
    public void Independent_backend_does_not_reference_legacy_infrastructure_or_database_providers()
    {
        var assemblies = new[] { typeof(Program).Assembly, typeof(CatalogService).Assembly,
            typeof(Product).Assembly, typeof(InMemoryUnitOfWork).Assembly };
        foreach (var assembly in assemblies)
            foreach (var reference in assembly.GetReferencedAssemblies())
                Assert.False(new[] { "FlowerFlow.Infrastructure", "Firebase", "Google.Cloud", "Sqlite", "EntityFramework", "SqlClient" }
                    .Any(prefix => reference.Name!.StartsWith(prefix, StringComparison.Ordinal)), $"{assembly.GetName().Name} references {reference.Name}");
    }

    [Fact]
    public void Controller_response_contracts_do_not_expose_entities()
    {
        var controllers = typeof(Program).Assembly.GetTypes().Where(type => typeof(ControllerBase).IsAssignableFrom(type));
        foreach (var controller in controllers)
            foreach (var action in controller.GetMethods(BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly))
                NoEntity(action.ReturnType, new HashSet<Type>(), controller.Name + "." + action.Name);
    }

    private static void NoEntity(Type type, HashSet<Type> visited, string action)
    {
        if (!visited.Add(type)) return;
        Assert.False(typeof(IEntity).IsAssignableFrom(type), $"{action} exposes {type.Name} instead of a response DTO.");
        if (type.IsArray) NoEntity(type.GetElementType()!, visited, action);
        foreach (var argument in type.GetGenericArguments()) NoEntity(argument, visited, action);
        if (type.Namespace?.StartsWith("FlowerFlow.", StringComparison.Ordinal) != true) return;
        foreach (var property in type.GetProperties(BindingFlags.Public | BindingFlags.Instance))
            NoEntity(property.PropertyType, visited, action);
    }
}
