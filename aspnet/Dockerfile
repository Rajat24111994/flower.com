# Build from the repository root: docker build -f aspnet/Dockerfile -t flowerflow-csharp .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY aspnet/src/FlowerFlow.Domain/FlowerFlow.Domain.csproj aspnet/src/FlowerFlow.Domain/
COPY aspnet/src/FlowerFlow.Application/FlowerFlow.Application.csproj aspnet/src/FlowerFlow.Application/
COPY aspnet/src/FlowerFlow.Infrastructure/FlowerFlow.Infrastructure.csproj aspnet/src/FlowerFlow.Infrastructure/
COPY aspnet/src/FlowerFlow.Api/FlowerFlow.Api.csproj aspnet/src/FlowerFlow.Api/
RUN dotnet restore aspnet/src/FlowerFlow.Api/FlowerFlow.Api.csproj
COPY aspnet/src/ aspnet/src/
COPY flower.com/ flower.com/
RUN dotnet publish aspnet/src/FlowerFlow.Api/FlowerFlow.Api.csproj --configuration Release --no-restore --output /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production \
    AUTH_MODE=firebase \
    ASPNETCORE_HTTP_PORTS=8080
COPY --from=build /out/ ./
USER $APP_UID:1000
EXPOSE 8080
ENTRYPOINT ["dotnet", "FlowerFlow.Api.dll"]
