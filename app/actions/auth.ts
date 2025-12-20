import { authClient } from "@/lib/auth-client"

export async function signup(formData: FormData) {

    const email = formData.get('email')
    const password = formData.get('password')

    authClient.signUp.email({
        email: email as string,
        password: password as string,
        name: (email as string).split("@")[0],
    })

    // Call the provider or db to create a user...
}