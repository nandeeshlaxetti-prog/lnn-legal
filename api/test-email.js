const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const transpConfig = {
            host: process.env.EMAIL_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.EMAIL_PORT || '465'),
            secure: process.env.EMAIL_PORT === '465',
            auth: {
                user: process.env.EMAIL_USER,
                pass: process.env.EMAIL_PASS
            }
        };

        const transporter = nodemailer.createTransport(transpConfig);

        const info = await transporter.sendMail({
            from: process.env.EMAIL_USER,
            to: process.env.EMAIL_USER, // Send to self
            subject: 'LNN Diagnostic Ping',
            text: 'If you see this, SMTP is working perfectly!'
        });

        return res.status(200).json({ success: true, host: transpConfig.host, port: transpConfig.port, user: transpConfig.auth.user, info });
    } catch (err) {
        return res.status(500).json({
            error: err.message,
            code: err.code,
            command: err.command,
            host: process.env.EMAIL_HOST,
            user: process.env.EMAIL_USER
        });
    }
};
