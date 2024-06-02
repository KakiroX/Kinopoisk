import React from "react";
import { Disclosure, Menu, Transition } from "@headlessui/react";
import { Bars3Icon, BellIcon, XMarkIcon } from "@heroicons/react/24/outline";
import logo from "../../public/images/logo.png";
import Image from "next/image";
import { Inter } from "next/font/google";
import { Fragment } from "react";
import Link from "next/link";

const Footer = () => {
  return (
    <div className="ligth">
      <footer className="bg-white dark:bg-gray-900 shadow-lg">
        <div className="mx-auto w-full max-w-screen-xl p-4 py-6 lg:py-8">
          <div className="md:flex md:justify-between">
            <div className="mb-6 md:mb-0">
              <Link href="#" className="flex items-center">
                {/* <img src={logo} className="h-8 mr-3" alt="FlowBite Logo" /> */}
                <Image
                  className="mr-3 mt-5"
                  alt="Kinopoisk"
                  width={250}
                  src={logo}
                  placeholder="blur"
                />
              </Link>
              <div className="self-center text-lg font-semibold whitespace-nowrap  dark:text-zinc-300">
                {/* problem tmr, matha betha amadr */}
              </div>
            </div>

          </div>
          <hr className="my-6 border-gray-200 sm:mx-auto dark:border-gray-700 lg:my-8" />
          <div className="sm:flex sm:items-center sm:justify-between">
            <span className="text-sm text-gray-500 sm:text-center dark:text-gray-400">
              © 2024{" "}
              <Link href="/" className="hover:underline">
                Kinopoisk™
              </Link>
              . All Rights Reserved.
            </span>
            <div className="flex mt-4 space-x-6 sm:justify-center sm:mt-0">
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Footer;
