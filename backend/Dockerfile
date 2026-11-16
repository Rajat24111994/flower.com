FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY backend/Flower.Api/ backend/Flower.Api/
COPY flower.com/ flower.com/
RUN dotnet restore backend/Flower.Api/Flower.Api.csproj --locked-mode
RUN dotnet publish backend/Flower.Api/Flower.Api.csproj --no-restore -c Release -o /app

FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER $APP_UID
ENTRYPOINT ["dotnet", "Flower.Api.dll"]
