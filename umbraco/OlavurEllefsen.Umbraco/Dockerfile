FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
ARG BUILD_CONFIGURATION=Release
WORKDIR /src
COPY OlavurEllefsen.Umbraco/OlavurEllefsen.Umbraco.csproj OlavurEllefsen.Umbraco/
RUN dotnet restore OlavurEllefsen.Umbraco/OlavurEllefsen.Umbraco.csproj
COPY . .
RUN dotnet publish OlavurEllefsen.Umbraco/OlavurEllefsen.Umbraco.csproj \
    --configuration "$BUILD_CONFIGURATION" \
    --output /app/publish \
    /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS final
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080
RUN apt-get update \
    && apt-get install -y --no-install-recommends gosu \
    && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/publish .
COPY OlavurEllefsen.Umbraco/docker-entrypoint.sh /usr/local/bin/umbraco-entrypoint
RUN mkdir -p /data /app/umbraco/Data /app/umbraco/Logs /app/wwwroot/media \
    && chown -R "$APP_UID:$APP_UID" /data /app/umbraco /app/wwwroot/media \
    && chmod 0755 /usr/local/bin/umbraco-entrypoint
EXPOSE 8080
ENTRYPOINT ["umbraco-entrypoint"]
