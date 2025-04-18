import mqtt from "mqtt";
import dotenv from "dotenv";
import fetch from "node-fetch"; 

dotenv.config();

const options = {
    host: process.env.HOST,
    port: process.env.PORT,
    username: process.env.USERNAME, 
    password: process.env.PASSWORD,
    clean: true, 
    protocol: "mqtt",
};

const name_port = "stocks/info";

console.log("Conectando a MQTT broker:", options);

const client = mqtt.connect(options);

client.on("connect", () => {
    console.log("Connected to MQTT broker");
    client.subscribe(name_port, (err) => {
        if (!err) {
            console.log("Subscribed to:", name_port);
        } else {
            console.error("Subscription error:", err);
        }
    });
});

client.on("message", (topic, message) => {
    const data = { topic, message: message.toString() };
    console.log("Sending to /stocks:", data);

    fetch(process.env.API_URL || "http://api:3000/stocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data)
    })
    .then(res => {
        if (!res.ok) {
            throw new Error(`HTTP error! Status: ${res.status}`);
        }
        return res.json();
    })
    .then(data => console.log("Response:", data))
    .catch(err => console.error("Erro with the response:", err));
});


export default client;