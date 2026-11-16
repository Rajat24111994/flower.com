# Build from the repository root: docker build -f flower.com/backend/Dockerfile -t flowerflow-csharp .
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /source
COPY flower.com/backend/FlowerFlow.Domain/FlowerFlow.Domain.csproj flower.com/backend/FlowerFlow.Domain/
COPY flower.com/backend/FlowerFlow.Application/FlowerFlow.Application.csproj flower.com/backend/FlowerFlow.Application/
COPY flower.com/backend/FlowerFlow.Infrastructure/FlowerFlow.Infrastructure.csproj flower.com/backend/FlowerFlow.Infrastructure/
COPY flower.com/backend/FlowerFlow.Api/FlowerFlow.Api.csproj flower.com/backend/FlowerFlow.Api/
RUN dotnet restore flower.com/backend/FlowerFlow.Api/FlowerFlow.Api.csproj
COPY flower.com/ flower.com/
RUN dotnet publish flower.com/backend/FlowerFlow.Api/FlowerFlow.Api.csproj --configuration Release --no-restore --output /out /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_ENVIRONMENT=Production \
    AUTH_MODE=firebase \
    ASPNETCORE_HTTP_PORTS=8080
COPY --from=build /out/ ./
USER $APP_UID:1000
EXPOSE 8080
ENTRYPOINT ["dotnet", "FlowerFlow.Api.dll"]
