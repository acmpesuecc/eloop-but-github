"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";

export default function SignInClient() {
    const [isLoading, setIsLoading] = useState(false);
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl") || "/dashboard";
    const message = searchParams.get("message");

    const handleSignIn = async (provider: string) => {
        setIsLoading(true);
        await signIn(provider, { callbackUrl });
    };

    // Read hero image env var (trim to avoid whitespace-only values)
    const heroImage = (process.env.NEXT_PUBLIC_SIGNIN_IMAGE || "").trim();

    return (
        <div className="flex min-h-screen flex-col items-center justify-center p-6 bg-gray-50">
            <div className="w-full max-w-md p-8 space-y-8 bg-white rounded-lg shadow-md">
                <div className="text-center">
                    {/* Optional hero image (kept at top) - only render if an image is configured */}
                    {heroImage ? (
                        <div className="mx-auto mb-4 w-40 h-24 relative">
                            <Image
                                src={heroImage}
                                alt={process.env.NEXT_PUBLIC_SIGNIN_TITLE || "Sign in"}
                                fill
                                sizes="160px"
                                style={{ objectFit: "contain" }}
                            />
                        </div>
                    ) : null}

                    <h1 className="text-3xl font-bold">
                        {process.env.NEXT_PUBLIC_SIGNIN_TITLE || "Welcome to eloop"}
                    </h1>
                    <p className="mt-2 text-gray-600">
                        {process.env.NEXT_PUBLIC_SIGNIN_SUBTITLE ||
                            "Sign in to access our event management system"}
                    </p>
                </div>

                {/* Show message if present */}
                {message && (
                    <div className="bg-blue-50 border border-blue-200 text-blue-700 px-4 py-3 rounded">
                        <p className="text-sm">{message}</p>
                    </div>
                )}

                {/* OAuth Providers */}
                <div>
                    <button
                        onClick={() => handleSignIn("github")}
                        disabled={isLoading}
                        className="w-full flex items-center justify-center gap-3 py-2 px-4 border border-gray-300 rounded-md shadow-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Image src="/github.svg" alt="GitHub" width={20} height={20} />
                        <span>Sign in with GitHub</span>
                    </button>
                </div>

                {/* Powered by footer */}
                <div className="mt-6 text-center text-sm text-gray-500 flex items-center justify-center gap-2">
                    <span className="text-gray-400">powered by</span>

                    <a
                        href="https://github.com/homebrew-ec-foss/eloop"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-semibold text-gray-800 hover:text-indigo-600"
                        aria-label="Eloop on GitHub"
                    >
                        eloop:
                    </a>
                    <a
                        href="https://hsp-ec.xyz"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center justify-center w-5 h-5 ml-0"
                        aria-label="HSP site"
                    >
                        <div className="w-5 h-5 relative">
                            <Image
                                src={process.env.NEXT_PUBLIC_HSP_LOGO || "https://hsp-ec.xyz/static/images/hsplogo.svg"}
                                alt={"HSP logo"}
                                fill
                                sizes="20px"
                                style={{ objectFit: "contain" }}
                            />
                        </div>
                    </a>
                </div>
            </div>
        </div>
    );
}
