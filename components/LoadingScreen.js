// components/LoadingScreen.js
import React from "react";
import Navbar from "./Navbar";

const LoadingScreen = () => {
    return (
        <div className="p-4 max-w-3xl mx-auto text-center text-white">
            <Navbar />
            <div className="mt-12 bg-[#0e1628] rounded-xl p-6 shadow-md flex flex-col items-center justify-center space-y-4">
                <svg
                    className="animate-spin h-6 w-6 text-yellow-400"
                    viewBox="0 0 24 24"
                    fill="none"
                    xmlns="http://www.w3.org/2000/svg"
                >
                    <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                    />
                    <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v8H4z"
                    />
                </svg>
                <p className="text-yellow-400 animate-pulse font-medium">
                    ⏳ Preparing your dashboard...
                </p>
            </div>
        </div>
    );
};

export default LoadingScreen;
