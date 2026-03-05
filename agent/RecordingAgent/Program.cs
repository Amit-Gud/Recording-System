using RecordingAgent;
using RecordingAgent.Configuration;

var builder = Host.CreateDefaultBuilder(args)
    .UseWindowsService(options =>
    {
        options.ServiceName = "RecordingAgent";
    })
    .ConfigureAppConfiguration((_, config) =>
    {
        config.AddJsonFile("appsettings.json", optional: false, reloadOnChange: false);
    })
    .ConfigureServices((ctx, services) =>
    {
        services.Configure<AgentConfig>(ctx.Configuration.GetSection("Agent"));
        services.AddHostedService<Worker>();
    });

await builder.Build().RunAsync();
